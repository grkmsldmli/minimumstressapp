import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { explainRejection, planBooking } from "./booking-plan";
import { resolveCancellation, type BookingMoney } from "./money";
import { notifyBookingCreated, notifyCancellation } from "./notify/for-booking";
import { SESSION_MINUTES } from "./session";
import { customerFor } from "./stripe/subscription";

/**
 * Creating and cancelling a booking, server-side.
 *
 * Everything that decides money is recomputed here from rows the client cannot
 * write. The request supplies a space and a start time, and nothing else — no
 * price, no instant flag, no credit amount. A client that could name its own
 * total would simply name a smaller one, and a client that could claim Pro
 * would get the discount without paying for it.
 *
 * The steps are ordered so a failure leaves nothing half-done. See the
 * comments in `createBooking` — Postgres and Stripe cannot share a
 * transaction, so the sequence is chosen to make the surviving states
 * recoverable rather than to pretend they cannot happen.
 */

const ACCESS_CODE_LEAD_MS = 30 * 60 * 1000;

export interface CreateBookingRequest {
  spaceId: string;
  startsAt: Date;
}

export interface CreateBookingResult {
  bookingId: string;
  money: BookingMoney;
  clientSecret: string;
}

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Four digits from the platform CSPRNG, never reused across bookings. */
function generateAccessCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 10_000).padStart(4, "0");
}

export interface StripeGateway {
  /** Takes the practitioner's money. The host is not named, and is not paid. */
  charge(
    money: BookingMoney,
    meta: { bookingId: string; spaceId: string; practitionerId: string },
    /** Whose card to keep. Without it the charge is anonymous and unrepeatable. */
    customerId?: string,
  ): Promise<{ paymentIntentId: string; clientSecret: string }>;
  /** Returns what went back, so the booking can record it. */
  settle(paymentIntentId: string, paidCents: number, outcome: {
    action: "void" | "capture_full";
    chargedCents: number;
  }): Promise<{ refundedCents: number }>;
  /** Sends the host their rate, out of the charge that funded it. */
  payHost(
    money: BookingMoney,
    hostAccountId: string,
    paymentIntentId: string,
    meta: { bookingId: string; spaceId: string; practitionerId: string },
  ): Promise<{ transferId: string }>;
}

export async function createBooking(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  practitionerId: string,
  request: CreateBookingRequest,
  now = new Date(),
): Promise<CreateBookingResult> {
  const { data: space, error: spaceError } = await admin
    .from("spaces")
    .select("id, host_id, hourly_rate_cents, buffer_minutes, timezone, status")
    .eq("id", request.spaceId)
    .maybeSingle();
  if (spaceError) throw spaceError;

  const [
    { data: practitioner },
    { data: hostRow },
    { data: blocks },
    { data: taken },
    { count: upcomingCount },
  ] = await Promise.all([
      admin
        .from("profiles")
        .select("id, is_pro, stripe_customer_id")
        .eq("id", practitionerId)
        .maybeSingle(),
      space
        ? admin
            .from("profiles")
            .select("stripe_connect_account_id, stripe_connect_charges_enabled")
            .eq("id", space.host_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      space
        ? admin
            .from("availability")
            .select("weekday, start_minute, end_minute")
            .eq("space_id", space.id)
        : Promise.resolve({ data: [] }),
      space
        ? admin
            .from("bookings")
            .select("starts_at")
            .eq("space_id", space.id)
            .in("status", ["upcoming", "completed"])
        : Promise.resolve({ data: [] }),

      /*
       * This practitioner's own sessions still ahead, across every space.
       *
       * Counted on the server from rows the client cannot write. A limit the
       * browser reports on itself is a limit anybody can set to zero, and this
       * one is what Pro sells.
       */
      admin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("practitioner_id", practitionerId)
        .eq("status", "upcoming")
        .gt("starts_at", new Date().toISOString()),
    ]);

  // Every rule about what may be booked and for how much lives in planBooking,
  // so this route and the pricing tests cannot drift apart.
  const plan = planBooking({
    upcomingCount: upcomingCount ?? 0,
    space: space
      ? {
          id: space.id,
          hostId: space.host_id,
          hourlyRateCents: space.hourly_rate_cents,
          bufferMinutes: space.buffer_minutes,
          timeZone: space.timezone,
          status: space.status,
          availability: (blocks ?? []).map((b) => ({
            weekday: b.weekday,
            startMinute: b.start_minute,
            endMinute: b.end_minute,
          })),
        }
      : null,
    host: hostRow
      ? {
          stripeAccountId: hostRow.stripe_connect_account_id,
          // The column name says charges; the webhook stores both flags ANDed.
          payable: hostRow.stripe_connect_charges_enabled,
        }
      : null,
    practitioner: {
      id: practitionerId,
      // From the stored row, never the request — otherwise the Pro discount
      // is free to anyone willing to edit a payload.
      isPro: practitioner?.is_pro ?? false,
    },
    takenStarts: (taken ?? []).map((b) => new Date(b.starts_at)),
    startsAt: request.startsAt,
    now,
  });

  if (!plan.ok) {
    const { message, status } = explainRejection(plan.reason);
    throw new BookingError(message, status);
  }

  const { money, isInstant } = plan;
  const isPro = practitioner?.is_pro ?? false;
  const endsAt = new Date(request.startsAt.getTime() + SESSION_MINUTES * 60_000);

  // The booking row goes in first, with no payment intent attached. If the
  // Stripe call then fails, what survives is a booking that was never charged
  // — visible, unpaid, and safe to reap. The reverse order would leave a
  // charge on someone's card with no record explaining it.
  const { data: booking, error: insertError } = await admin
    .from("bookings")
    .insert({
      // planBooking already refused a null space, but the compiler cannot see
      // that through the result type, and the request's own id is the same
      // value without the assertion.
      space_id: request.spaceId,
      practitioner_id: practitionerId,
      starts_at: request.startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      is_instant: isInstant,
      was_pro: isPro,
      host_rate_cents: money.hostRateCents,
      service_fee_cents: money.serviceFeeCents,
      instant_fee_cents: money.instantFeeCents,
      pro_discount_cents: money.proDiscountCents,
      /*
       * Always zero, and the column is the last of a feature that never was.
       *
       * A comment here once said a host cancellation writes goodwill credit to
       * the ledger. Nothing ever did — no writer, no reader, `quote()` takes no
       * balance — while three screens and the terms promised it. The promise is
       * gone now, replaced by refunds that actually move money; the column
       * stays because it is not-null and dropping it is a separate decision.
       *
       * Leaving it out of this insert did not mean "none". It meant the insert
       * failed, and with it every booking ever attempted through this route.
       */
      credit_applied_cents: 0,
      total_cents: money.totalCents,
      platform_cents: money.platformCents,
      access_code: generateAccessCode(),
      access_code_revealed_at: new Date(
        request.startsAt.getTime() - ACCESS_CODE_LEAD_MS,
      ).toISOString(),
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  try {
    /*
     * The host's account is not passed and not needed. They are paid after the
     * session, by the sweep, out of the balance this charge lands in — see
     * stripe/payments.ts. It is still checked before we get here: planBooking
     * refuses a host who cannot be paid, because taking somebody's money for a
     * session we could not settle would be the worse failure.
     */
    /*
     * A customer, so the card can be kept.
     *
     * Resolved here rather than at sign-up because this is the first moment it
     * is needed and the first moment a card exists to attach. Reused across
     * bookings and shared with the Pro subscription — two customers for one
     * person is two payment histories that nobody can reconcile.
     */
    const customerId = await customerFor(
      practitionerId,
      // profiles carries no email; the metadata link is what makes the Stripe
      // row identifiable, and Pro fills the address in if they ever subscribe.
      null,
      practitioner?.stripe_customer_id ?? null,
    );

    if (customerId !== practitioner?.stripe_customer_id) {
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", practitionerId);
    }

    const charged = await stripeGateway.charge(
      money,
      {
        bookingId: booking.id,
        spaceId: request.spaceId,
        practitionerId,
      },
      customerId,
    );

    await admin
      .from("bookings")
      .update({
        stripe_payment_intent_id: charged.paymentIntentId,
        authorized_at: new Date().toISOString(),
      })
      .eq("id", booking.id);

    // After the money, and deliberately not awaited into the failure path: the
    // booking is real whether or not an email goes out, so a provider outage
    // must not roll back a payment. notifyBookingCreated swallows its own
    // errors for the same reason.
    await notifyBookingCreated(admin, booking.id);

    return { bookingId: booking.id, money, clientSecret: charged.clientSecret };
  } catch (error) {
    // Undo the row rather than leave an unpayable booking occupying an hour
    // that other practitioners could have had.
    await admin.from("bookings").delete().eq("id", booking.id);
    throw error;
  }
}

/**
 * Cancel, and move whatever money the policy says should move.
 *
 * The outcome comes from `resolveCancellation`, so this route and the mock
 * repository cannot drift on the 24-hour rule or on how much goodwill a host
 * cancellation earns.
 */
export async function cancelBooking(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  bookingId: string,
  actor: "practitioner" | "host",
  requesterId: string,
  now = new Date(),
): Promise<void> {
  const { data: booking, error } = await admin
    .from("bookings")
    .select("*, spaces!inner(host_id)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) throw new BookingError("No such booking", 404);
  if (booking.status !== "upcoming") {
    throw new BookingError("That booking is already closed", 409);
  }

  // Whoever is asking must actually be the party they claim to be.
  const hostId = (booking.spaces as { host_id: string }).host_id;
  const allowed =
    actor === "practitioner"
      ? booking.practitioner_id === requesterId
      : hostId === requesterId;
  if (!allowed) throw new BookingError("Not your booking to cancel", 403);

  const money: BookingMoney = {
    hostRateCents: booking.host_rate_cents,
    serviceFeeCents: booking.service_fee_cents,
    instantFeeCents: booking.instant_fee_cents,
    proDiscountCents: booking.pro_discount_cents,
    totalCents: booking.total_cents,
    platformCents: booking.platform_cents,
  };

  /*
   * Read from the booking rather than the profile. `was_pro` is what they held
   * when they paid, and a subscription that lapsed afterwards must not
   * retroactively add a fee to a session they bought under Pro.
   */
  const outcome = resolveCancellation(
    money,
    actor,
    new Date(booking.starts_at),
    now,
    Boolean(booking.was_pro),
  );

  /*
   * What we are actually holding, which is not the same as what was quoted.
   *
   * The card is charged when the payment sheet is completed, not when the row
   * is written, so a booking abandoned at the card form has a total and no
   * money behind it. Refunding against the quoted figure there would send real
   * money to somebody who never paid any.
   */
  const paidCents = booking.captured_at ? booking.total_cents : 0;

  let refundedCents = 0;
  if (booking.stripe_payment_intent_id) {
    ({ refundedCents } = await stripeGateway.settle(
      booking.stripe_payment_intent_id,
      paidCents,
      outcome,
    ));
  }

  await admin
    .from("bookings")
    .update({
      status: actor === "host" ? "cancelled_by_host" : "cancelled_by_practitioner",
      cancelled_at: now.toISOString(),
      cancelled_by: actor,
      // Both or neither — the row constraint says so, and the payout sweep
      // reads this to know the money is no longer ours to pass on.
      ...(refundedCents > 0
        ? { refunded_at: now.toISOString(), refunded_cents: refundedCents }
        : {}),
    })
    .eq("id", bookingId);

  // Nothing to award: a host's cancellation refunds in full and that is the
  // whole compensation.

  /*
   * Last, so the figures quoted are the ones that actually landed — and taken
   * from what Stripe did rather than from what the policy said, so an email
   * can never describe a refund that was not made.
   */
  await notifyCancellation(admin, bookingId, actor, {
    chargedCents: outcome.chargedCents,
    refundedCents,
  });
}
