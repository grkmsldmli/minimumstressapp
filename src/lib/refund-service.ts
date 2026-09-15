import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FinancialResolutionState } from "./financial-resolution";
import {
  executeMoneyOperation,
  MoneyOperationExecutionError,
} from "./money-operation-service";
import { claimRefundDecision } from "./money-operations";
import { notifyRefundRequested } from "./notify/for-refund";
import {
  REQUEST_WINDOW_DAYS,
  type RefundOutcome,
  type RefundReason,
  canRequestRefund,
  routeRefund,
} from "./refunds";

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
  financial_resolution_state: FinancialResolutionState;
}

async function loadBooking(admin: SupabaseClient, bookingId: string): Promise<BookingRow> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, space_id, status, starts_at, total_cents, host_rate_cents, stripe_payment_intent_id, captured_at, stripe_transfer_id, host_paid_at, refunded_cents, financial_resolution_state",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new RefundError("No such booking", 404);
  return data as BookingRow;
}

/**
 * Cancellation settlement and discretionary refunds must never race each
 * other. Only a booking with no outstanding resolution work can open or
 * decide a separate refund request; unknown future states fail closed too.
 */
function requireSettledBooking(booking: BookingRow): void {
  if (
    booking.financial_resolution_state !== "not_required" &&
    booking.financial_resolution_state !== "resolved"
  ) {
    throw new RefundError(
      "This booking's cancellation is still being finalized. Try again after it is resolved.",
      409,
    );
  }
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

  requireSettledBooking(booking);

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

  const initialState =
    route.kind === "ask_host"
      ? "awaiting_host"
      : "awaiting_staff";

  const decidedNow = route.kind === "decided";

  const { data: created, error: insertError } = await admin
    .from("refund_requests")
    .insert({
      booking_id: bookingId,
      practitioner_id: practitionerId,
      reason: input.reason,
      detail: input.detail,
      evidence_path: input.evidencePath,
      // Even an automatic decision starts undecided.  The database claim is
      // the one place that is allowed to turn a request into a decision, so a
      // process crash can never leave an approved row whose Stripe refund was
      // not made.
      state: initialState,
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

  // This describes the durable request, not a successful refund.  A decision
  // email is emitted by executeMoneyOperation only after its provider receipt
  // and the domain rows commit together.
  await notifyRefundRequested(admin, created.id).catch(() => {});

  if (decidedNow) {
    await settleRefundDecision(
      admin,
      created.id,
      practitionerId,
      route.outcome,
      route.because,
      now,
    );
  }

  return {
    state:
      decidedNow && route.outcome === "none"
        ? "refused"
        : decidedNow
          ? "approved"
          : initialState,
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

  const { data: updated, error: updateError } = await admin
    .from("refund_requests")
    .update({
      host_reply: reply,
      host_replied_at: now.toISOString(),
      // Answered or not, a person decides. The host's reply is evidence, not
      // a verdict — letting it close the request would hand the decision to
      // the side with money at stake.
      state: "awaiting_staff",
    })
    .eq("id", requestId)
    // Compare-and-set: another host tab, staff action or timeout sweep may
    // have moved the request after the ownership read above. Only the caller
    // that still owns `awaiting_host` may record the reply.
    .eq("state", "awaiting_host")
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    throw new RefundError("This request is no longer waiting on you", 409);
  }
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
  requireSettledBooking(booking);
  const refunded = await settleRefundDecision(
    admin,
    requestId,
    staffId,
    outcome,
    note,
    now,
  );

  return { refundedCents: refunded };
}

/**
 * Claims the decision before touching Stripe, then lets the journal own every
 * retry and completion.  A null claim is deliberately one public answer for a
 * competing staff click, a different verdict, or another active money action:
 * none of those callers may race the owner of the durable lease.
 */
async function settleRefundDecision(
  admin: SupabaseClient,
  requestId: string,
  decisionActorId: string,
  outcome: RefundOutcome,
  note: string,
  now: Date,
): Promise<number> {
  const operation = await claimRefundDecision(
    admin,
    { requestId, decisionActorId, outcome, note },
    undefined,
    now,
  );
  if (!operation) {
    throw new RefundError("This request changed while the decision was starting", 409);
  }

  try {
    const result = await executeMoneyOperation(admin, operation, undefined, now);
    if (!result.committed) {
      throw new RefundError("The refund is waiting for Stripe confirmation", 503);
    }
    return result.refundedCents;
  } catch (failure) {
    if (failure instanceof MoneyOperationExecutionError) {
      throw new RefundError(failure.message, failure.manualReview ? 409 : 503);
    }
    throw failure;
  }
}
