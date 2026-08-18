import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyRefundDecided, notifyRefundRequested } from "./notify/for-refund";
import {
  REQUEST_WINDOW_DAYS,
  type RefundOutcome,
  type RefundReason,
  canRequestRefund,
  refundCents,
  routeRefund,
} from "./refunds";
import { refundRequested } from "./stripe/client";

/**
 * The server half of a refund request: the checks a browser must not be
 * trusted with, and the money.
 *
 * Every rule about *whether* and *how much* lives in `refunds.ts`, which is
 * pure and tested. What lives here is everything that needs the database — was
 * this booking really paid, has this person asked three times already, has the
 * host been paid yet — and the one irreversible act at the end.
 */

export class RefundError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface BookingRow {
  id: string;
  practitioner_id: string;
  space_id: string;
  status: string;
  starts_at: string;
  total_cents: number;
  host_rate_cents: number;
  stripe_payment_intent_id: string | null;
  /** Written by the `payment_intent.succeeded` webhook, and by nothing else. */
  captured_at: string | null;
  stripe_transfer_id: string | null;
  host_paid_at: string | null;
  refunded_cents: number | null;
}

async function loadBooking(admin: SupabaseClient, bookingId: string): Promise<BookingRow> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, space_id, status, starts_at, total_cents, host_rate_cents, stripe_payment_intent_id, captured_at, stripe_transfer_id, host_paid_at, refunded_cents",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new RefundError("No such booking", 404);
  return data as BookingRow;
}

/**
 * Opens a request, and settles it immediately only where no other account of
 * events is needed.
 *
 * The ordering matters: the row is written before any money moves, so a refund
 * that succeeds can never end up without a record of why it happened.
 */
export async function requestRefund(
  admin: SupabaseClient,
  bookingId: string,
  practitionerId: string,
  input: { reason: RefundReason; detail: string; evidencePath: string | null },
  now = new Date(),
): Promise<{ state: string; outcome: RefundOutcome | null; because: string }> {
  const booking = await loadBooking(admin, bookingId);

  // Checked rather than trusted: the id in the URL says nothing about who is
  // asking, and a request against somebody else's booking would otherwise
  // reveal that it exists.
  if (booking.practitioner_id !== practitionerId) {
    throw new RefundError("No such booking", 404);
  }

  /*
   * Captured, not merely attempted. An intent id says a card form was opened,
   * which is also true of a checkout somebody abandoned — and one of those,
   * once released, is a cancelled booking that would otherwise look refundable
   * and send us to Stripe asking for money back that never arrived.
   */
  const paidCents = booking.captured_at ? booking.total_cents : 0;
  if (
    !canRequestRefund({
      status: booking.status,
      paidCents,
      refundedCents: booking.refunded_cents ?? 0,
    })
  ) {
    throw new RefundError("There is nothing to refund on this booking", 409);
  }

  const { count, error: countError } = await admin
    .from("refund_requests")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", practitionerId)
    .gte(
      "created_at",
      new Date(now.getTime() - REQUEST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
  if (countError) throw countError;

  const route = routeRefund({
    reason: input.reason,
    sessionStart: new Date(booking.starts_at),
    now,
    recentRequests: count ?? 0,
    hostAlreadyPaid: Boolean(booking.host_paid_at),
  });

  const state =
    route.kind === "ask_host"
      ? "awaiting_host"
      : route.kind === "staff"
        ? "awaiting_staff"
        : route.outcome === "none"
          ? "refused"
          : "approved";

  const decidedNow = route.kind === "decided";

  const { data: created, error: insertError } = await admin
    .from("refund_requests")
    .insert({
      booking_id: bookingId,
      practitioner_id: practitionerId,
      reason: input.reason,
      detail: input.detail,
      evidence_path: input.evidencePath,
      state,
      ...(decidedNow
        ? {
            outcome: route.outcome,
            // The rule decided this one, so the rule is named as the decider.
            decided_by: practitionerId,
            decided_at: now.toISOString(),
            decision_note: route.because,
          }
        : {}),
    })
    .select("id")
    .single();

  // A second request on the same booking hits the unique constraint, which is
  // the mechanism working rather than an error worth showing as one.
  if (insertError) {
    if (insertError.code === "23505") {
      throw new RefundError("You have already asked about this booking", 409);
    }
    throw insertError;
  }

  if (decidedNow && route.outcome !== "none") {
    await payBack(admin, booking, route.outcome, created.id, now);
  }

  await notifyRefundRequested(admin, created.id).catch(() => {});

  return {
    state,
    outcome: decidedNow ? route.outcome : null,
    because: route.because,
  };
}

/** The host's account of the same events. */
export async function replyToRefund(
  admin: SupabaseClient,
  requestId: string,
  hostId: string,
  reply: string,
  now = new Date(),
): Promise<void> {
  const { data, error } = await admin
    .from("refund_requests")
    .select("id, state, bookings!inner(space_id, spaces!inner(host_id))")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RefundError("No such request", 404);

  const owner = (data as unknown as { bookings: { spaces: { host_id: string } } }).bookings.spaces
    .host_id;
  if (owner !== hostId) throw new RefundError("No such request", 404);
  if (data.state !== "awaiting_host") {
    throw new RefundError("This request is no longer waiting on you", 409);
  }

  const { error: updateError } = await admin
    .from("refund_requests")
    .update({
      host_reply: reply,
      host_replied_at: now.toISOString(),
      // Answered or not, a person decides. The host's reply is evidence, not
      // a verdict — letting it close the request would hand the decision to
      // the side with money at stake.
      state: "awaiting_staff",
    })
    .eq("id", requestId);
  if (updateError) throw updateError;
}

/** Staff decide, and this is where money actually moves. */
export async function decideRefund(
  admin: SupabaseClient,
  requestId: string,
  staffId: string,
  outcome: RefundOutcome,
  note: string,
  now = new Date(),
): Promise<{ refundedCents: number }> {
  const { data: request, error } = await admin
    .from("refund_requests")
    .select("id, booking_id, state")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!request) throw new RefundError("No such request", 404);

  if (request.state === "approved" || request.state === "refused") {
    throw new RefundError("This request has already been decided", 409);
  }

  const booking = await loadBooking(admin, request.booking_id as string);
  const refunded =
    outcome === "none" ? 0 : await payBack(admin, booking, outcome, requestId, now, staffId);

  const { error: updateError } = await admin
    .from("refund_requests")
    .update({
      state: outcome === "none" ? "refused" : "approved",
      outcome,
      decided_by: staffId,
      decided_at: now.toISOString(),
      decision_note: note,
      refunded_cents: refunded,
    })
    .eq("id", requestId)
    // Only from an undecided state, so two staff clicking at once cannot
    // refund twice — the second update matches no rows.
    .in("state", ["awaiting_host", "awaiting_staff"]);
  if (updateError) throw updateError;

  await notifyRefundDecided(admin, requestId).catch(() => {});

  return { refundedCents: refunded };
}

/**
 * Moves the money, and takes it from whoever should be out of pocket.
 *
 * A refund request arrives after the session, so the host may already have
 * been paid. Returning the full amount from our own balance would mean us
 * absorbing a host's mistake, so when the whole booking is being refunded and
 * the payout has gone, the host's transfer is reversed for their share first.
 *
 * The middle outcome never needs that: our fee never left our balance.
 */
async function payBack(
  admin: SupabaseClient,
  booking: BookingRow,
  outcome: RefundOutcome,
  requestId: string,
  now: Date,
  _staffId?: string,
): Promise<number> {
  const amount = refundCents(outcome, {
    totalCents: booking.total_cents,
    hostRateCents: booking.host_rate_cents,
  });
  if (amount <= 0) return 0;

  if (!booking.stripe_payment_intent_id) {
    throw new RefundError("This booking was never paid", 409);
  }

  const alreadyRefunded = booking.refunded_cents ?? 0;
  const room = booking.total_cents - alreadyRefunded;
  if (amount > room) {
    throw new RefundError("That is more than is left on this booking", 409);
  }

  const clawBack =
    outcome === "full" && booking.host_paid_at ? booking.host_rate_cents : 0;

  const { refundedCents } = await refundRequested(
    booking.stripe_payment_intent_id,
    amount,
    booking.stripe_transfer_id,
    clawBack,
    requestId,
  );

  const { error } = await admin
    .from("bookings")
    .update({
      refunded_at: now.toISOString(),
      refunded_cents: alreadyRefunded + refundedCents,
    })
    .eq("id", booking.id);
  if (error) throw error;

  return refundedCents;
}
