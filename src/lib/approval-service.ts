import type { SupabaseClient } from "@supabase/supabase-js";

import { BookingError, type StripeGateway } from "./booking-service";
import { canAnswer, expiresAt, explainApprovalRefusal, hasExpired } from "./booking-approval";
import {
  FINANCIAL_RESOLUTION_SELECT,
  initialFinancialResolution,
  resolveApprovalCaptureFinancial,
  resolveRequestHoldFinancial,
  type FinancialResolutionRow,
} from "./financial-resolution";
import {
  notifyRequestApproved,
  notifyRequestDeclined,
  notifyRequestExpired,
  notifyRequestReminder,
} from "./notify/for-booking";

/**
 * Answering a request, and sweeping up the ones nobody answered.
 *
 * The rules about *whether* a request can still be answered are in
 * booking-approval.ts, as pure functions over a clock. This file is the part
 * that has to touch three things at once — the row, the hold, and the person
 * waiting — and the order it touches them in is the whole design.
 *
 * The row goes first, always. Both webhooks that Stripe sends back here are
 * guarded on the booking's status, so writing the row before calling Stripe is
 * what stops `payment_intent.canceled` arriving and relabelling a host's
 * decline as a practitioner cancellation. Doing it the other way round would
 * be correct about the money and wrong about who did what, which is the half
 * that ends up in front of somebody in a dispute.
 */

export type Decision = "approve" | "decline";

/**
 * A host answers a request on their own room.
 *
 * Not written as two functions, because approve and decline share every check
 * that matters and differ only in the last two steps. Splitting them would
 * mean maintaining the ownership check and the clock check twice, and the one
 * that got out of step would be the one that lets somebody answer for a room
 * they do not own.
 */
export async function answerRequest(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  bookingId: string,
  hostId: string,
  decision: Decision,
  note: string | null = null,
  now = new Date(),
): Promise<void> {
  const { data: booking, error } = await admin
    .from("bookings")
    .select("*, spaces!inner(host_id)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) throw new BookingError("No such booking", 404);

  if ((booking.spaces as { host_id: string }).host_id !== hostId) {
    // 404 rather than 403. A host poking at ids that are not theirs should not
    // be told which ones exist.
    throw new BookingError("No such booking", 404);
  }

  if (
    booking.status !== "upcoming" ||
    booking.cancelled_at !== null ||
    booking.financial_resolution_state !== "not_required"
  ) {
    throw new BookingError("This request is no longer open", 409);
  }

  const refusal = canAnswer(
    {
      approvalState: booking.approval_state,
      requestedAt: new Date(booking.created_at),
      startsAt: new Date(booking.starts_at),
    },
    now,
  );
  if (refusal) throw new BookingError(explainApprovalRefusal(refusal), 409);

  /*
   * A request with no intent behind it.
   *
   * The card form was opened and never completed, so there is nothing to
   * capture and nothing to release. The reaper in booking-service already
   * clears these; approving one would confirm a session nobody has paid for.
   */
  if (!booking.stripe_payment_intent_id) {
    throw new BookingError("That request was never paid for", 409);
  }

  if (decision === "approve") {
    const financial = initialFinancialResolution(true, now);
    /*
     * The row first, then the money — the opposite of the decline path below,
     * and for the same reason read the other way round. A capture that
     * succeeds after the row says `approved` is the state we want; a capture
     * that succeeds while the row still says `pending` would leave a guest
     * charged for a request that reads as unanswered. The state written here
     * is what `payment_intent.succeeded` then completes by stamping
     * `captured_at`, which is the field everything downstream actually reads.
     */
    const { data: answered, error: answerError } = await admin
      .from("bookings")
      .update({
        approval_state: "approved",
        approval_decided_at: now.toISOString(),
        approval_note: note,
        ...financial.patch,
      })
      .eq("id", bookingId)
      // Nobody answers twice. A second tap selects no rows and returns quietly
      // rather than capturing a hold that is already captured.
      .eq("approval_state", "pending")
      .eq("status", "upcoming")
      .is("cancelled_at", null)
      .eq("financial_resolution_state", "not_required")
      .select(FINANCIAL_RESOLUTION_SELECT);
    if (answerError) throw answerError;
    if (!answered?.length) return;

    try {
      await resolveApprovalCaptureFinancial(
        admin,
        stripeGateway,
        answered[0] as FinancialResolutionRow,
        financial.leaseToken!,
        now,
      );
    } catch (failure) {
      // Approval is durable and the slot remains blocked. The financial worker
      // retries capture; no approval receipt is allowed ahead of provider
      // confirmation and the signed succeeded webhook.
      console.error(`Approved-request capture queued for booking ${bookingId}:`, failure);
      return;
    }
    await notifyRequestApproved(admin, bookingId);
    return;
  }

  const closed = await closeRequest(admin, stripeGateway, booking, "declined", note, now);
  if (closed === "resolved") await notifyRequestDeclined(admin, bookingId);
}

/**
 * End a request without a session: declined, or out of time.
 *
 * Both write the same three things and release the same hold, so they are one
 * function — the difference is a word in the row and which message goes out,
 * and it is the caller's to make.
 */
async function closeRequest(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  booking: { id: string; stripe_payment_intent_id: string | null },
  state: "declined" | "expired",
  note: string | null,
  now: Date,
): Promise<false | "pending" | "resolved"> {
  const financial = initialFinancialResolution(
    Boolean(booking.stripe_payment_intent_id),
    now,
  );
  const { data: closed, error: closeError } = await admin
    .from("bookings")
    .update({
      approval_state: state,
      approval_decided_at: now.toISOString(),
      approval_note: note,
      /*
       * `cancelled_by_host` because the schema has no status for "never became
       * a booking", and of the five it does have this is the only one that is
       * true about which side it stopped on.
       *
       * It costs the host nothing, which had to be checked rather than
       * assumed: suspensions are counted by listCancellationHistory, and that
       * reads `cancelled_by` on bookings that were captured. A request is
       * neither — the column is left null just below, and the money was only
       * ever held. So declining is free, which is what makes it a real
       * option rather than one a host learns to avoid.
       */
      // A live hold is still payable until Stripe confirms its release. Keep
      // the slot blocked while the financial worker owns that gap; finalizing
      // the leased resolution is what moves it to cancelled_by_host.
      status: booking.stripe_payment_intent_id ? "upcoming" : "cancelled_by_host",
      cancelled_at: now.toISOString(),
      /*
       * Left null for both. `cancelled_by` names a person who cancelled a
       * session, and nobody here did: a decline refuses a request rather than
       * cancelling a booking, and an expiry has no actor at all. Null is also
       * what keeps these out of listCancellationHistory, which reads this
       * column rather than the status.
       */
      cancelled_by: null,
      ...financial.patch,
    })
    .eq("id", booking.id)
    .eq("approval_state", "pending")
    .eq("status", "upcoming")
    .is("cancelled_at", null)
    .eq("financial_resolution_state", "not_required")
    .select(FINANCIAL_RESOLUTION_SELECT);
  if (closeError) throw closeError;
  if (!closed?.length) return false;

  if (financial.leaseToken) {
    try {
      await resolveRequestHoldFinancial(
        admin,
        stripeGateway,
        closed[0] as FinancialResolutionRow,
        financial.leaseToken,
        now,
      );
    } catch (failure) {
      // The terminal request is durable. A leased worker retries the release,
      // and no receipt may claim success before that provider fact is stored.
      console.error(`Hold release queued for booking ${booking.id}:`, failure);
      return "pending";
    }
  }

  return "resolved";
}

/**
 * The requests nobody answered.
 *
 * Run from the cron sweep. A pending request occupies its hour — it is
 * `upcoming`, so availability counts it — which is right while somebody is
 * waiting on an answer and wrong once nobody is coming. Without this the room
 * stays blocked indefinitely by a host who looked away, and the guest's money
 * stays held behind it.
 *
 * Deliberately does the whole page rather than stopping at the first failure.
 * One request whose hold Stripe has already expired must not leave the rest of
 * the queue held for another twelve hours.
 */
export async function expireStaleRequests(
  admin: SupabaseClient,
  stripeGateway: StripeGateway,
  now = new Date(),
): Promise<{ expired: number }> {
  const { data: pending, error } = await admin
    .from("bookings")
    .select("id, created_at, starts_at, stripe_payment_intent_id")
    .eq("approval_state", "pending")
    .eq("status", "upcoming")
    .is("cancelled_at", null)
    .eq("financial_resolution_state", "not_required");
  if (error) throw error;

  let expired = 0;

  for (const booking of pending ?? []) {
    const stale = hasExpired(
      {
        approvalState: "pending",
        requestedAt: new Date(booking.created_at),
        startsAt: new Date(booking.starts_at),
      },
      now,
    );
    if (!stale) continue;

    try {
      const closed = await closeRequest(admin, stripeGateway, booking, "expired", null, now);
      if (!closed) continue;
      expired += 1;
      if (closed === "resolved") await notifyRequestExpired(admin, booking.id);
    } catch (failure) {
      console.error(`Could not expire request ${booking.id}:`, failure);
    }
  }

  return { expired };
}

/**
 * A nudge to hosts who still have time, once.
 *
 * Sent at the halfway mark rather than immediately, because the first message
 * went out when the request arrived and a second one an hour later is not a
 * reminder, it is pestering. Halfway is the point where the deadline has
 * become the relevant fact.
 *
 * Once is enforced by `notify` itself, which claims a unique key per kind and
 * subject — so this can run on every cron pass and only the first one after
 * the halfway mark sends anything.
 */
export async function remindWaitingHosts(
  admin: SupabaseClient,
  now = new Date(),
): Promise<{ reminded: number }> {
  const { data: pending, error } = await admin
    .from("bookings")
    .select("id, created_at, starts_at")
    .eq("approval_state", "pending")
    .eq("status", "upcoming")
    .is("cancelled_at", null)
    .eq("financial_resolution_state", "not_required");
  if (error) throw error;

  let reminded = 0;

  for (const booking of pending ?? []) {
    const request = {
      approvalState: "pending" as const,
      requestedAt: new Date(booking.created_at),
      startsAt: new Date(booking.starts_at),
    };
    if (hasExpired(request, now)) continue;

    const total = expiresAt(request).getTime() - request.requestedAt.getTime();
    if (now.getTime() - request.requestedAt.getTime() < total / 2) continue;

    await notifyRequestReminder(admin, booking.id);
    reminded += 1;
  }

  return { reminded };
}
