import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DeclaredUse } from "./booking-use";

import { abandonedBefore } from "./abandoned";
import { type HeldBookingRow, isHeldBooking } from "./booking-visibility";
import {
  explainRejection,
  planBooking,
  planSeries,
  type HostFacts,
  type PractitionerFacts,
  type SpaceFacts,
} from "./booking-plan";
import { resolveCancellation, type BookingMoney } from "./money";
import { notifyCancellation } from "./notify/for-booking";
import { toCancellationEvents, type CancellationEvent } from "./reliability";
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
  /**
   * What the space will be used for, and how many people will be there.
   *
   * Required. A booking with no declaration is refused by planBooking rather
   * than stored with a null — the record is the whole point of asking, and one
   * that can be empty is one that will be.
   */
  declared: DeclaredUse;
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

/**
 * Cancel unpaid holds on one room, so the hour goes back on sale.
 *
 * The Stripe intent is cancelled first and the row is only freed if that
 * worked. The order matters: freeing the row while the intent is still live
 * would let the person who abandoned the checkout hit Pay afterwards and
 * succeed — paying, in full, for an hour we had already resold to somebody
 * else.
 *
 * Everything here is best-effort. A booking that cannot be released stays
 * exactly as it was, which is the state this whole function exists to
 * improve, so failing quietly is safe.
 */
async function releaseAbandoned(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  spaceId: string,
  now: Date,
): Promise<void> {
  try {
    const { data: stale } = await admin
      .from("bookings")
      .select("id, stripe_payment_intent_id")
      .eq("space_id", spaceId)
      .eq("status", "upcoming")
      .is("captured_at", null)
      .lt("created_at", abandonedBefore(now).toISOString());

    for (const booking of stale ?? []) {
      if (booking.stripe_payment_intent_id) {
        await stripeGateway.settle(booking.stripe_payment_intent_id, 0, {
          action: "void",
          chargedCents: 0,
        });
      }

      await admin
        .from("bookings")
        .update({
          status: "cancelled_by_practitioner",
          cancelled_at: now.toISOString(),
          cancelled_by: "practitioner",
        })
        .eq("id", booking.id)
        .eq("status", "upcoming")
        .is("captured_at", null);
    }
  } catch (failure) {
    console.error(`Could not release abandoned bookings on ${spaceId}:`, failure);
  }
}

export interface StripeGateway {
  /** Takes the practitioner's money. The host is not named, and is not paid. */
  charge(
    money: BookingMoney,
    meta: { bookingId: string; spaceId: string; practitionerId: string },
    /** Whose card to keep. Without it the charge is anonymous and unrepeatable. */
    customerId?: string,
    /** True to hold the money rather than take it, until the host answers. */
    awaitingApproval?: boolean,
  ): Promise<{ paymentIntentId: string; clientSecret: string }>;
  /** Takes a hold the host approved. */
  capture(paymentIntentId: string, bookingId: string): Promise<void>;
  /** Gives a hold back, because the host declined or never answered. */
  release(paymentIntentId: string): Promise<void>;
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

/**
 * Everything planBooking needs about a room and a booker, read in one place.
 *
 * Pulled out of createBooking so the recurring preflight can gather the facts
 * once and judge every occurrence against them, instead of each occurrence
 * re-reading — and so the two paths cannot drift on which columns decide a
 * booking. `stripeCustomerId` is carried through for the commit; nothing else
 * here is anything the client wrote.
 */
interface BookingFacts {
  space: SpaceFacts | null;
  host: HostFacts | null;
  practitioner: PractitionerFacts;
  takenStarts: Date[];
  upcomingCount: number;
  /**
   * This practitioner's qualifying late cancellations, for the standing pause.
   *
   * Built through `toCancellationEvents`, the same rule the profile card and the
   * admin watchlist use, so the gate and the card can never disagree: only
   * cancellations of bookings that were genuinely captured count, which drops
   * abandoned checkouts and other automatic releases, and `standingFor` then
   * keeps only the practitioner's own.
   */
  practitionerCancellations: CancellationEvent[];
  /** The stored Stripe customer, so the card can be kept. Not used by the gate. */
  stripeCustomerId: string | null;
}

async function gatherBookingFacts(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  practitionerId: string,
  spaceId: string,
  now: Date,
): Promise<BookingFacts> {
  const { data: space, error: spaceError } = await admin
    .from("spaces")
    .select(
      "id, host_id, hourly_rate_cents, buffer_minutes, timezone, status, capacity, allowed_uses, booking_mode",
    )
    .eq("id", spaceId)
    .maybeSingle();
  if (spaceError) throw spaceError;

  /*
   * Give back this room's abandoned hours before deciding what is free.
   *
   * The nightly job does the same sweep, but twice a day is no help to the
   * person looking at the calendar right now: they would see an hour marked
   * taken by a checkout somebody closed a week ago. Doing it here means the
   * one room somebody is actually trying to book is always current.
   */
  if (space) await releaseAbandoned(admin, stripeGateway, space.id, now);

  const [
    { data: practitioner },
    { data: hostRow },
    { data: blocks },
    { data: taken },
    { data: upcomingRows },
    { data: cancels },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, is_pro, stripe_customer_id, account_type, identity_verified_at, insurance_doc_path, insurance_doc_state, insurance_effective_date, insurance_expires_at",
      )
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
      // The fields the held-booking rule reads, not a raw count: an unpaid
      // instant checkout hold (not_required, captured_at null) is upcoming in
      // the table but is not a committed session, so it must not consume the
      // Free plan's allowance. isHeldBooking makes that call, the same rule the
      // bookings list uses.
      .select("captured_at, approval_state, authorized_at")
      .eq("practitioner_id", practitionerId)
      .eq("status", "upcoming")
      .gt("starts_at", new Date().toISOString()),

    /*
     * This practitioner's own cancellations, for the standing pause.
     *
     * All cancellations of their own bookings, judged by the shared
     * `toCancellationEvents` rule below rather than by a query clause: an
     * abandoned checkout is released as a `cancelled_by = practitioner`
     * cancellation with no `captured_at`, so filtering on cancelled_by alone
     * would count a closed tab as a strike. `captured_at` is fetched precisely
     * so that rule can exclude it, and `standingFor` then keeps only the
     * practitioner's own and applies the 24-hour and 90-day lines.
     */
    admin
      .from("bookings")
      .select("starts_at, cancelled_at, captured_at, cancelled_by")
      .eq("practitioner_id", practitionerId)
      .not("cancelled_at", "is", null),
  ]);

  return {
    space: space
      ? {
          id: space.id,
          hostId: space.host_id,
          hourlyRateCents: space.hourly_rate_cents,
          bufferMinutes: space.buffer_minutes,
          capacity: space.capacity,
          // Empty means the host has not answered yet, which reads as
          // "everything permitted" — see allowsUse.
          allowedUses: (space.allowed_uses as string[] | null) ?? [],
          bookingMode: space.booking_mode === "request" ? "request" : "instant",
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
      /*
       * The account's side and its liability cover, both read from the stored
       * row for the same reason: only a practitioner may book, and only with
       * verified cover that is valid for the whole session. A crafted request
       * cannot assert either — planBooking is what refuses when they are wrong,
       * and the recurring flow checks each occurrence's interval against this
       * same window. Columns from 0054; a row read before it ran has no dates,
       * which reads as unverified rather than as cover.
       */
      accountType: (practitioner?.account_type as "practitioner" | "host" | null) ?? null,
      // Server-written only (Stripe Identity webhook); a client cannot assert it.
      identityVerified: Boolean(practitioner?.identity_verified_at),
      insurance: {
        hasCertificate: Boolean(practitioner?.insurance_doc_path),
        state:
          (practitioner?.insurance_doc_state as "pending" | "verified" | "rejected") ?? "pending",
        effectiveDate: practitioner?.insurance_effective_date
          ? new Date(practitioner.insurance_effective_date)
          : null,
        expiresAt: practitioner?.insurance_expires_at
          ? new Date(practitioner.insurance_expires_at)
          : null,
      },
    },
    takenStarts: (taken ?? []).map((b) => new Date(b.starts_at)),
    upcomingCount: ((upcomingRows ?? []) as HeldBookingRow[]).filter(isHeldBooking).length,
    // The shared rule: abandoned checkouts (no captured_at) drop out here, the
    // same way the profile card and admin watchlist drop them, and standingFor
    // keeps only this practitioner's own from what remains.
    practitionerCancellations: toCancellationEvents(
      (cancels ?? []).map((row) => ({
        cancelledBy: row.cancelled_by,
        capturedAt: row.captured_at,
        cancelledAt: row.cancelled_at,
        sessionStart: row.starts_at,
      })),
    ),
    stripeCustomerId: practitioner?.stripe_customer_id ?? null,
  };
}

export async function createBooking(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  practitionerId: string,
  request: CreateBookingRequest,
  now = new Date(),
): Promise<CreateBookingResult> {
  const facts = await gatherBookingFacts(admin, stripeGateway, practitionerId, request.spaceId, now);

  // Every rule about what may be booked and for how much lives in planBooking,
  // so this route and the pricing tests cannot drift apart.
  const plan = planBooking({
    space: facts.space,
    host: facts.host,
    practitioner: facts.practitioner,
    takenStarts: facts.takenStarts,
    upcomingCount: facts.upcomingCount,
    practitionerCancellations: facts.practitionerCancellations,
    declared: request.declared,
    startsAt: request.startsAt,
    now,
  });

  if (!plan.ok) {
    const { message, status } = explainRejection(plan.reason);
    throw new BookingError(message, status);
  }

  const { money, isInstant, needsApproval } = plan;
  const isPro = facts.practitioner.isPro;
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
      /*
       * What was declared, written with the booking and never rewritten — a
       * trigger in 0049 refuses an update to any of these three.
       *
       * The note is stored only for "something else", because the fixed
       * purposes already say what they are and a stray note beside one of them
       * is a second, unvalidated answer to a question already answered.
       */
      purpose: request.declared.purpose,
      purpose_note:
        request.declared.purpose === "other" ? (request.declared.purposeNote ?? null) : null,
      attendee_count: request.declared.attendees,
      /*
       * Whether the host has to say yes.
       *
       * `pending` holds the hour and holds the card without taking it — the
       * charge below is created for manual capture when this is set. Approving
       * captures it, declining and expiring release it. See booking-approval.ts
       * for why a hold works here and not on an ordinary booking.
       */
      approval_state: needsApproval ? "pending" : "not_required",
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
      facts.stripeCustomerId,
    );

    if (customerId !== facts.stripeCustomerId) {
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
      needsApproval,
    );

    await admin
      .from("bookings")
      .update({
        stripe_payment_intent_id: charged.paymentIntentId,
        authorized_at: new Date().toISOString(),
      })
      .eq("id", booking.id);

    /*
     * Nobody is told yet, and the comment that used to sit here was wrong.
     *
     * It read "after the money". This point is a PaymentIntent created and a
     * card form about to be rendered — the practitioner has not entered a card
     * and may never do so. The host was emailed "New booking" from this line,
     * and thirty minutes later the reaper in abandoned.ts quietly took the hour
     * back, because nothing notifies on that path. A studio that moved its
     * afternoon around the email had no way to learn the session was gone.
     *
     * The telling moved to `payment_intent.succeeded`, which is the moment the
     * money reaches us. Capture is automatic, so that webhook arrives seconds
     * after the card is confirmed rather than after the session.
     */

    return { bookingId: booking.id, money, clientSecret: charged.clientSecret };
  } catch (error) {
    // Undo the row rather than leave an unpayable booking occupying an hour
    // that other practitioners could have had.
    await admin.from("bookings").delete().eq("id", booking.id);
    throw error;
  }
}

/**
 * Whether a whole recurring run could be booked, without booking any of it.
 *
 * Gathers the room-and-booker facts once and asks planSeries to judge every
 * occurrence against them — professional eligibility, cover for each week's
 * interval, availability, allowed use, every rule a single booking passes. The
 * caller runs this before creating or charging anything, so a run that cannot
 * be whole is refused before the first week is taken. The failing occurrence is
 * named, with its reason already turned into words.
 */
export async function preflightSeries(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  practitionerId: string,
  spaceId: string,
  starts: readonly Date[],
  declared: DeclaredUse,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; startsAt: Date; message: string; status: number }> {
  const facts = await gatherBookingFacts(admin, stripeGateway, practitionerId, spaceId, now);

  const result = planSeries({
    space: facts.space,
    host: facts.host,
    practitioner: facts.practitioner,
    takenStarts: facts.takenStarts,
    upcomingCount: facts.upcomingCount,
    practitionerCancellations: facts.practitionerCancellations,
    declared,
    starts,
    now,
  });

  if (result.ok) return { ok: true };

  const { message, status } = explainRejection(
    result.reason,
    facts.space
      ? { allowedUses: facts.space.allowedUses, capacity: facts.space.capacity }
      : undefined,
  );
  return { ok: false, startsAt: result.startsAt, message, status };
}

/**
 * Undo a batch of bookings created moments ago, best-effort.
 *
 * The safety net under an atomic series: if a later occurrence cannot be
 * committed after earlier ones already were, the earlier ones are taken back so
 * no partial run survives. Each charge is still an uncaptured intent at this
 * point — chargeBooking creates it without confirming — so voiding it is clean,
 * the same undo releaseAbandoned uses. Failures are logged, not thrown: this
 * runs while already handling a failure, and the caller's error is the one that
 * should surface.
 */
export async function rollbackSeries(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  bookingIds: readonly string[],
): Promise<void> {
  for (const id of bookingIds) {
    try {
      const { data: row } = await admin
        .from("bookings")
        .select("stripe_payment_intent_id")
        .eq("id", id)
        .maybeSingle();
      if (row?.stripe_payment_intent_id) {
        await stripeGateway.settle(row.stripe_payment_intent_id, 0, {
          action: "void",
          chargedCents: 0,
        });
      }
      await admin.from("bookings").delete().eq("id", id);
    } catch (failure) {
      console.error(`Could not roll back series booking ${id}:`, failure);
    }
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
