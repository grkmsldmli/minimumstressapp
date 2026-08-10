import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { explainRejection, planBooking } from "./booking-plan";
import { resolveCancellation, type BookingMoney } from "./money";
import { notifyBookingCreated, notifyCancellation } from "./notify/for-booking";
import { settlementFor } from "./stripe/payments";

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

const SESSION_MINUTES = 60;
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
  authorize(
    money: BookingMoney,
    hostAccountId: string,
    meta: { bookingId: string; spaceId: string; practitionerId: string },
  ): Promise<{ paymentIntentId: string; clientSecret: string }>;
  settle(paymentIntentId: string, capturedCents: number, outcome: {
    action: "void" | "capture_full";
    chargedCents: number;
  }): Promise<void>;
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
      admin.from("profiles").select("id, is_pro").eq("id", practitionerId).maybeSingle(),
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
          chargesEnabled: hostRow.stripe_connect_charges_enabled,
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
  const hostAccountId = hostRow!.stripe_connect_account_id as string;
  const isPro = practitioner?.is_pro ?? false;
  const endsAt = new Date(request.startsAt.getTime() + SESSION_MINUTES * 60_000);

  // The booking row goes in first, with no payment intent attached. If the
  // Stripe call then fails, what survives is a booking that was never
  // authorised — visible, unpaid, and safe to reap. The reverse order would
  // leave a hold on someone's card with no record explaining it.
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
    const authorized = await stripeGateway.authorize(money, hostAccountId, {
      bookingId: booking.id,
      spaceId: request.spaceId,
      practitionerId,
    });

    await admin
      .from("bookings")
      .update({
        stripe_payment_intent_id: authorized.paymentIntentId,
        authorized_at: new Date().toISOString(),
      })
      .eq("id", booking.id);

    // After the money, and deliberately not awaited into the failure path: the
    // booking is real whether or not an email goes out, so a provider outage
    // must not roll back an authorised hold. notifyBookingCreated swallows its
    // own errors for the same reason.
    await notifyBookingCreated(admin, booking.id);

    return { bookingId: booking.id, money, clientSecret: authorized.clientSecret };
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

  const outcome = resolveCancellation(money, actor, new Date(booking.starts_at), now);
  const capturedCents = booking.captured_at ? booking.total_cents : 0;

  if (booking.stripe_payment_intent_id) {
    await stripeGateway.settle(booking.stripe_payment_intent_id, capturedCents, outcome);
  }

  await admin
    .from("bookings")
    .update({
      status: actor === "host" ? "cancelled_by_host" : "cancelled_by_practitioner",
      cancelled_at: now.toISOString(),
      cancelled_by: actor,
    })
    .eq("id", bookingId);

  // Nothing to award: a host's cancellation releases the hold in full and
  // that is the whole compensation.

  // Last, so the figures quoted are the ones that actually landed.
  // Taken from the settlement rather than inferred, so the message can never
  // describe a refund Stripe was not asked to make. The usual cancellation is
  // a void of an uncaptured hold: nothing left the card, so nothing returns.
  const settlement = settlementFor(outcome, capturedCents);

  await notifyCancellation(admin, bookingId, actor, {
    chargedCents: outcome.chargedCents,
    refundedCents: settlement.kind === "refund" ? settlement.amountCents : 0,
  });
}
