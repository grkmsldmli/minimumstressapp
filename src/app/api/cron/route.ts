import type { NextRequest } from "next/server";

import { abandonedBefore } from "@/lib/abandoned";
import { expireStaleRequests, remindWaitingHosts } from "@/lib/approval-service";
import { stripeGateway } from "@/lib/api/stripe-gateway";
import { safetyRecipient } from "@/lib/admin/access";
import { subjectFor, waitingOn, waitingSignature } from "@/lib/admin/attention";
import { runWithIndependentRetention } from "@/lib/cron-runner";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { retryFinancialResolutions } from "@/lib/financial-resolution";
import {
  enqueueMarketingLifecycles,
  processMarketingOutbox,
} from "@/lib/marketing/outbox";
import { executeMoneyOperation } from "@/lib/money-operation-service";
import { claimMoneyOperationRetries, claimPayout } from "@/lib/money-operations";
import {
  notifyAccessCodesReady,
  reconcileBookingConfirmationNotifications,
  reconcileCancellationNotifications,
  reconcileHostPayoutNotifications,
  reconcileRequestOutcomeNotifications,
  reconcileRequestSubmissionNotifications,
} from "@/lib/notify/for-booking";
import {
  reconcileRefundDecisionNotifications,
  reconcileRefundRequestNotifications,
} from "@/lib/notify/for-refund";
import { processMessageNotificationJobs } from "@/lib/notify/message-jobs";
import { notify, retryPending } from "@/lib/notify/send";
import {
  notifyReviewRequests,
  reconcileReviewLifecycleNotifications,
} from "@/lib/notify/for-review";
import { settle } from "@/lib/stripe/client";
import { siteUrl } from "@/lib/site-url";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Capturing payment when a session starts — the one thing that has to happen
 * on a clock rather than on a click.
 *
 * Revealing access codes deliberately is *not* here. A booking stores its own
 * `access_code_revealed_at` (start minus thirty minutes) and
 * `bookings_with_access_code` returns the code only once that moment has
 * passed, so the reveal happens on time whether or not anything is running.
 * A job would be strictly worse: it could be late, and the code would then be
 * late with it. What will need a job is *notifying* someone their code is
 * ready, which arrives with email.
 *
 * That distinction was worth catching — a first version of this file did run a
 * reveal job, and a live test appeared to prove it worked. It had not: the code
 * was already visible before the job ran, and the job reported zero rows
 * touched.
 *
 * Capture is driven by comparing database state to the current time, not by a
 * timer set when the booking was made. That is the difference between a job
 * that self-heals and one that silently drops work: if this does not run for
 * two hours, the next run catches everything it missed, because the query asks
 * "what is due and unhandled" rather than "what became due since I last ran".
 */

export async function GET(request: NextRequest): Promise<Response> {
  const authorization = await authorizeCronRequest(request);
  if (!authorization.ok) {
    return new Response(authorization.message, { status: authorization.status });
  }

  const now = new Date();

  const outcome = await runWithIndependentRetention(
    () => runOperationalTasks(now),
    () => pruneAnalyticsEvents(now),
  );

  if (!outcome.operational.ok || !outcome.retention.ok) {
    const failures: { operational?: string; analyticsRetention?: string } = {};

    // Supabase rejects with a plain object rather than an Error, so the default
    // logging renders it as `{}` — useless at 3am when a payout run has
    // stopped. Pull the fields out by hand.
    if (!outcome.operational.ok) {
      failures.operational = describe(outcome.operational.error);
      console.error("Cron run failed:", failures.operational);
    }
    if (!outcome.retention.ok) {
      failures.analyticsRetention = describe(outcome.retention.error);
      console.error("Analytics retention failed:", failures.analyticsRetention);
    }

    return Response.json(
      {
        ranAt: now.toISOString(),
        error: "Cron run incomplete",
        failures,
        ...(outcome.operational.ok ? outcome.operational.value : {}),
        ...(outcome.retention.ok ? outcome.retention.value : {}),
      },
      { status: 500 },
    );
  }

  return Response.json({
    ranAt: now.toISOString(),
    ...outcome.operational.value,
    ...outcome.retention.value,
  });
}

/**
 * Sequential: legacy hold resolutions, durable money retries, then payouts.
 *
 * A cancellation can still be waiting for Stripe to confirm its refund or
 * hold release. Resolving those rows first keeps a payout from overtaking that
 * work. The payout query also excludes unresolved rows, so a failed financial
 * retry remains safely blocked rather than paying the host while the guest's
 * cancellation is unsettled.
 */
export async function runOperationalTasks(now: Date) {
  const financial = await settlePendingFinancialWork(now);
  const moneyRetries = await retryDueMoneyOperations(now);
  const paid = await payHostsForFinishedSessions(now);
  const payoutReceipts = await reconcilePayoutReceipts(now);
  const released = await releaseAbandonedCheckouts(now);
  const bookingConfirmations = await reconcileBookingConfirmations(now);
  /*
   * Before the access codes: an expired request is an hour a studio cannot
   * sell and money held on somebody's card. Both keep getting worse until
   * this runs.
   */
  const requests = await sweepRequests(now);
  const requestSubmissions = await reconcileRequestSubmissions(now);
  const requestOutcomes = await reconcileRequestOutcomes(now);
  const refundRequests = await reconcileRefundRequests(now);
  const refundDecisions = await reconcileRefundDecisions(now);
  const cancellations = await reconcileCancellations(now);
  const messageJobs = await recoverMessageNotifications(now);
  const reviews = await nudgeForReviews(now);
  const announced = await announceAccessCodes(now);
  const retried = await retryFailedNotifications();
  const waiting = await reportWhatIsWaiting(now);
  const marketing = await runMarketingLifecycles(now);

  return {
    ...financial,
    ...moneyRetries,
    ...paid,
    ...payoutReceipts,
    ...released,
    ...bookingConfirmations,
    ...requests,
    ...requestSubmissions,
    ...requestOutcomes,
    ...refundRequests,
    ...refundDecisions,
    ...cancellations,
    ...messageJobs,
    ...reviews,
    ...announced,
    ...retried,
    ...waiting,
    ...marketing,
  };
}

async function runMarketingLifecycles(now: Date): Promise<{
  marketingConfigured: boolean;
  marketingProfilesScanned: number;
  marketingProfilesEligible: number;
  marketingEnqueued: number;
  marketingClaimed: number;
  marketingSent: number;
  marketingRetrying: number;
  marketingFailed: number;
  marketingSuppressed: number;
}> {
  const admin = supabaseAdmin();
  const queued = await enqueueMarketingLifecycles(admin, now);
  const delivered = await processMarketingOutbox(admin, { now, limit: 50 });
  return {
    marketingConfigured: queued.configured,
    marketingProfilesScanned: queued.profilesScanned,
    marketingProfilesEligible: queued.profilesEligible,
    marketingEnqueued: queued.enqueued,
    marketingClaimed: delivered.claimed,
    marketingSent: delivered.sent,
    marketingRetrying: delivered.retrying,
    marketingFailed: delivered.failed,
    marketingSuppressed: delivered.suppressed,
  };
}

async function recoverMessageNotifications(
  now: Date,
): Promise<{
  messageJobsClaimed: number;
  messageJobsCompleted: number;
  messageJobsRetrying: number;
  messageJobsFailed: number;
}> {
  try {
    const result = await processMessageNotificationJobs(supabaseAdmin(), { limit: 100, now });
    return {
      messageJobsClaimed: result.claimed,
      messageJobsCompleted: result.completed,
      messageJobsRetrying: result.retrying,
      messageJobsFailed: result.failed,
    };
  } catch (error) {
    console.error("Message notification recovery failed:", describe(error));
    return {
      messageJobsClaimed: 0,
      messageJobsCompleted: 0,
      messageJobsRetrying: 0,
      messageJobsFailed: 1,
    };
  }
}


async function nudgeForReviews(
  now: Date,
): Promise<{
  reviewPrompts: number;
  reviewReminders: number;
  reviewReceipts: number;
  counterpartReviews: number;
  reviewsPublished: number;
}> {
  try {
    const admin = supabaseAdmin();
    const [nudges, lifecycle] = await Promise.all([
      notifyReviewRequests(admin, now),
      reconcileReviewLifecycleNotifications(admin, now),
    ]);
    return {
      reviewPrompts: nudges.prompted,
      reviewReminders: nudges.reminded,
      reviewReceipts: lifecycle.submitted,
      counterpartReviews: lifecycle.counterpart,
      reviewsPublished: lifecycle.published,
    };
  } catch (error) {
    console.error("Review prompts failed:", describe(error));
    return {
      reviewPrompts: 0,
      reviewReminders: 0,
      reviewReceipts: 0,
      counterpartReviews: 0,
      reviewsPublished: 0,
    };
  }
}

async function settlePendingFinancialWork(
  now: Date,
): Promise<{
  financialResolutionsClaimed: number;
  financialResolutionsCompleted: number;
  financialResolutionsRetrying: number;
  financialResolutionsManualReview: number;
}> {
  try {
    const result = await retryFinancialResolutions(
      supabaseAdmin(),
      stripeGateway,
      100,
      now,
    );
    return {
      financialResolutionsClaimed: result.claimed,
      financialResolutionsCompleted: result.resolved,
      financialResolutionsRetrying: result.retrying,
      financialResolutionsManualReview: result.manualReview,
    };
  } catch (error) {
    console.error("Financial resolution retries failed:", describe(error));
    return {
      financialResolutionsClaimed: 0,
      financialResolutionsCompleted: 0,
      financialResolutionsRetrying: 0,
      financialResolutionsManualReview: 0,
    };
  }
}

const ANALYTICS_RETENTION_DAYS = 90;

/**
 * Raw product-usage events are operational counters, not permanent customer
 * history. The scheduled sweep enforces the same 90-day limit the public
 * privacy policy promises; booking/payment records remain untouched.
 */
async function pruneAnalyticsEvents(
  now: Date,
): Promise<{ analyticsEventsPruned: number }> {
  const cutoff = new Date(
    now.getTime() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const { error, count } = await supabaseAdmin()
    .from("analytics_events")
    .delete({ count: "exact" })
    .lt("occurred_at", cutoff);
  if (error) throw error;
  return { analyticsEventsPruned: count ?? 0 };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: string; details?: string; hint?: string; code?: string };
    return [e.code, e.message, e.details, e.hint].filter(Boolean).join(" — ") || JSON.stringify(error);
  }
  return String(error);
}

/**
 * Give back hours that were taken and never paid for.
 *
 * The booking row is written before the card is charged, on purpose — a charge
 * with no row is worse than a row with no charge. `booking-service` says as
 * much and calls the leftover "visible, unpaid, and safe to reap". Nothing
 * reaped it, so a closed tab at the card form blocked a studio's hour
 * permanently, ate one of a free account's three concurrent sessions, and
 * counted toward "booked this month" as money nobody paid.
 *
 * Cancelling the Stripe intent is what actually closes the booking: the
 * `payment_intent.canceled` webhook already moves the row to cancelled, and
 * routing through it means a hand-cancelled intent in the Stripe dashboard
 * ends the same way. The row is updated here too, because a webhook that is
 * slow or misconfigured must not leave the hour blocked.
 *
 * Failures are counted rather than thrown, for the same reason as payouts: one
 * stale intent must not stop the rest from being released.
 */
async function releaseAbandonedCheckouts(
  now: Date,
): Promise<{ released: number; releaseFailed: number }> {
  const admin = supabaseAdmin();

  const { data: stale, error } = await admin
    .from("bookings")
    .select("id, stripe_payment_intent_id")
    .eq("status", "upcoming")
    // Never paid. This is the whole safety condition — `captured_at` is
    // written by the `payment_intent.succeeded` webhook and by nothing else.
    .is("captured_at", null)
    .is("cancelled_at", null)
    .is("active_money_operation_id", null)
    .eq("financial_resolution_state", "not_required")
    /*
     * Except a request still waiting on its host, which is uncaptured by
     * design and would otherwise be reaped half an hour after it was made.
     *
     * A request holds the card rather than charging it, so `captured_at` stays
     * null until the host approves — which is the one condition above. Without
     * this clause every request would be destroyed thirty minutes in, before
     * most hosts had looked at their phone, and the guest would be told their
     * booking was abandoned when they had done everything asked of them.
     *
     * `authorized_at is null` keeps the case this reaper is actually for: a
     * request whose card form was opened and closed has no authorisation
     * behind it, and is as abandoned as any other unpaid checkout. Requests
     * that were paid for expire on their own clock instead — see
     * expireStaleRequests, which is the sweep that owns them.
     */
    .or("approval_state.neq.pending,authorized_at.is.null")
    .lt("created_at", abandonedBefore(now).toISOString());

  if (error) throw error;
  if (!stale?.length) return { released: 0, releaseFailed: 0 };

  let released = 0;
  let releaseFailed = 0;

  for (const booking of stale) {
    try {
      if (booking.stripe_payment_intent_id) {
        await settle(booking.stripe_payment_intent_id, { kind: "abandon" });
      }

      const { error: updateError } = await admin
        .from("bookings")
        .update({
          status: "cancelled_by_practitioner",
          cancelled_at: now.toISOString(),
          cancelled_by: "practitioner",
        })
        .eq("id", booking.id)
        // Only from where we found it. If the card went through in the
        // meantime, this matches nothing and the booking stands.
        .eq("status", "upcoming")
        .is("captured_at", null)
        .is("cancelled_at", null)
        .is("active_money_operation_id", null)
        .eq("financial_resolution_state", "not_required");
      if (updateError) throw updateError;

      released += 1;
    } catch (failure) {
      releaseFailed += 1;
      console.error(`Could not release abandoned booking ${booking.id}:`, describe(failure));
    }
  }

  return { released, releaseFailed };
}

/**
 * Pay hosts for sessions that have happened.
 *
 * The practitioner's money was taken when they booked and has been sitting in
 * our balance since. This is the moment it stops being ours to give back and
 * becomes the host's — which is exactly why it waits until the session has
 * ended rather than happening at the point of sale or at check-in.
 *
 * A late cancellation is included on purpose. Cancelling inside 24 hours
 * charges in full precisely because the host kept the hour free, so they are
 * paid the same as if the practitioner had turned up. A host cancellation is
 * not: that money went back to the practitioner, and `refunded_at` is how this
 * query knows.
 *
 * Failures are collected rather than thrown. One host with a closed account
 * must not stop the other twenty from being paid.
 */
export async function payHostsForFinishedSessions(
  now: Date,
): Promise<{ paid: number; failed: number; payoutClaimsSkipped: number }> {
  const admin = supabaseAdmin();

  const { data: due, error } = await admin
    .from("bookings")
    // This is only a cheap candidate scan. The service-only claim RPC
    // re-checks every financial invariant under a row lock before any Stripe
    // call, so a cancellation that wins after this read makes the claim return
    // no row rather than racing a transfer.
    .select("id")
    // Hosts are paid after the booked session is over, not when it begins.
    .lte("ends_at", now.toISOString())
    .not("captured_at", "is", null)
    /*
     * Not `refunded_at is null`. That excluded a booking after any refund of
     * any size, and `our_fee` refunds the platform's share while leaving the
     * host's rate owed — so the outcome staff are told is the fairest one was
     * also the one that stopped the host being paid, permanently and with no
     * retry. See 0046: the column answers whether the refund reached the
     * host's own money.
     */
    .eq("host_rate_refunded", false)
    .is("host_paid_at", null)
    // A cancellation/refusal must finish its Stripe refund or hold release
    // before this booking can become payable. Manual-review rows stay blocked
    // until an operator resolves the provider ambiguity.
    .in("financial_resolution_state", ["not_required", "resolved"])
    .in("status", ["upcoming", "completed", "cancelled_by_practitioner", "no_show"]);

  if (error) throw error;
  if (!due?.length) return { paid: 0, failed: 0, payoutClaimsSkipped: 0 };

  let paid = 0;
  let failed = 0;
  let payoutClaimsSkipped = 0;

  for (const booking of due) {
    try {
      const operation = await claimPayout(admin, booking.id, undefined, now);
      if (!operation) {
        // A concurrent cancellation/refund/payout owns the booking, or the
        // candidate stopped being eligible after the scan. Neither is a
        // provider failure and neither may be bypassed with a direct write.
        payoutClaimsSkipped += 1;
        continue;
      }

      const result = await executeMoneyOperation(admin, operation, undefined, now);
      if (result.committed) paid += 1;
      else failed += 1;
    } catch (failure) {
      failed += 1;
      console.error(`Payout failed for booking ${booking.id}:`, describe(failure));
    }
  }

  return { paid, failed, payoutClaimsSkipped };
}

/**
 * Resume provider calls whose worker died or whose transient error is due for
 * another attempt. Each claimed operation has its own lease and failure
 * boundary, so one disputed Stripe record cannot block unrelated payouts,
 * cancellations, or refunds.
 */
async function retryDueMoneyOperations(
  now: Date,
): Promise<{
  moneyOperationsRetryClaimed: number;
  moneyOperationsRetried: number;
  moneyOperationsRetryFailed: number;
}> {
  const admin = supabaseAdmin();
  let operations;

  try {
    operations = await claimMoneyOperationRetries(admin, 25, undefined, now);
  } catch (failure) {
    console.error("Could not claim money-operation retries:", describe(failure));
    return {
      moneyOperationsRetryClaimed: 0,
      moneyOperationsRetried: 0,
      moneyOperationsRetryFailed: 1,
    };
  }

  let moneyOperationsRetried = 0;
  let moneyOperationsRetryFailed = 0;

  for (const operation of operations) {
    try {
      const result = await executeMoneyOperation(admin, operation, undefined, now);
      if (result.committed) moneyOperationsRetried += 1;
      else moneyOperationsRetryFailed += 1;
    } catch (failure) {
      moneyOperationsRetryFailed += 1;
      console.error(
        `Money-operation retry failed for ${operation.id}:`,
        describe(failure),
      );
    }
  }

  return {
    moneyOperationsRetryClaimed: operations.length,
    moneyOperationsRetried,
    moneyOperationsRetryFailed,
  };
}

/**
 * Tell practitioners their door code has unlocked.
 *
 * The code itself needs no job — see the note at the top of this file. This is
 * only the message, and it is the one the whole notification queue exists for:
 * somebody is about to stand in front of a door.
 *
 * Wrapped so a notification failure cannot take down the capture result that
 * was already computed. Nothing here is worth reporting a failed cron run for.
 */
/**
 * Requests that ran out of time, and hosts who still have some left.
 *
 * One pass rather than two jobs, because both read the same rows and the
 * decision between them is a clock comparison. Splitting them would mean two
 * queries returning the same set and two chances for them to disagree about
 * which requests are still open.
 */
async function sweepRequests(
  now: Date,
): Promise<{ requestsExpired: number; requestsReminded: number }> {
  try {
    const admin = supabaseAdmin();
    const { expired } = await expireStaleRequests(admin, stripeGateway, now);
    const { reminded } = await remindWaitingHosts(admin, now);
    return { requestsExpired: expired, requestsReminded: reminded };
  } catch (error) {
    // Counted as none rather than thrown: the payouts above have already run
    // and a failure here must not turn the whole sweep into a 500.
    console.error("Could not sweep booking requests:", describe(error));
    return { requestsExpired: 0, requestsReminded: 0 };
  }
}

async function announceAccessCodes(now: Date): Promise<{ announced: number }> {
  try {
    return await notifyAccessCodesReady(supabaseAdmin(), now);
  } catch (error) {
    console.error("Access code announcements failed:", describe(error));
    return { announced: 0 };
  }
}

async function reconcileCancellations(now: Date): Promise<{ cancellationsReconciled: number }> {
  try {
    const { reconciled } = await reconcileCancellationNotifications(supabaseAdmin(), now);
    return { cancellationsReconciled: reconciled };
  } catch (error) {
    console.error("Cancellation notification reconciliation failed:", describe(error));
    return { cancellationsReconciled: 0 };
  }
}

async function reconcileBookingConfirmations(
  now: Date,
): Promise<{ bookingConfirmationsReconciled: number }> {
  try {
    const { reconciled } = await reconcileBookingConfirmationNotifications(
      supabaseAdmin(),
      now,
    );
    return { bookingConfirmationsReconciled: reconciled };
  } catch (error) {
    console.error("Booking-confirmation notification reconciliation failed:", describe(error));
    return { bookingConfirmationsReconciled: 0 };
  }
}

async function reconcileRequestOutcomes(
  now: Date,
): Promise<{ requestOutcomesReconciled: number }> {
  try {
    const { reconciled } = await reconcileRequestOutcomeNotifications(supabaseAdmin(), now);
    return { requestOutcomesReconciled: reconciled };
  } catch (error) {
    console.error("Request-outcome notification reconciliation failed:", describe(error));
    return { requestOutcomesReconciled: 0 };
  }
}

async function reconcileRequestSubmissions(
  now: Date,
): Promise<{ requestSubmissionsReconciled: number }> {
  try {
    const { reconciled } = await reconcileRequestSubmissionNotifications(
      supabaseAdmin(),
      now,
    );
    return { requestSubmissionsReconciled: reconciled };
  } catch (error) {
    console.error("Request-submission notification reconciliation failed:", describe(error));
    return { requestSubmissionsReconciled: 0 };
  }
}

async function reconcileRefundDecisions(
  now: Date,
): Promise<{ refundDecisionsReconciled: number }> {
  try {
    const { reconciled } = await reconcileRefundDecisionNotifications(
      supabaseAdmin(),
      now,
    );
    return { refundDecisionsReconciled: reconciled };
  } catch (error) {
    console.error("Refund-decision notification reconciliation failed:", describe(error));
    return { refundDecisionsReconciled: 0 };
  }
}

async function reconcileRefundRequests(
  now: Date,
): Promise<{ refundRequestsReconciled: number }> {
  try {
    const { reconciled } = await reconcileRefundRequestNotifications(
      supabaseAdmin(),
      now,
    );
    return { refundRequestsReconciled: reconciled };
  } catch (error) {
    console.error("Refund-request notification reconciliation failed:", describe(error));
    return { refundRequestsReconciled: 0 };
  }
}

async function reconcilePayoutReceipts(
  now: Date,
): Promise<{ payoutReceiptsReconciled: number }> {
  try {
    const { reconciled } = await reconcileHostPayoutNotifications(supabaseAdmin(), now);
    return { payoutReceiptsReconciled: reconciled };
  } catch (error) {
    console.error("Payout notification reconciliation failed:", describe(error));
    return { payoutReceiptsReconciled: 0 };
  }
}

/** Second chance for anything a provider refused for a reason that may have passed. */
async function retryFailedNotifications(): Promise<{ notificationsSent: number }> {
  try {
    const { sent } = await retryPending();
    return { notificationsSent: sent };
  } catch (error) {
    console.error("Notification retries failed:", describe(error));
    return { notificationsSent: 0 };
  }
}

/**
 * Tells the operator what is waiting on them, when they are not looking.
 *
 * The staff screen already shows every one of these and shows them well. It
 * cannot reach anybody, though — it is a page, and a page has to be opened.
 * Two events sent mail before this and the rest waited for somebody to happen
 * to look, which holds right up until a host is standing in a studio they
 * opened for a session we cannot pay them for.
 *
 * Last in the run on purpose. Everything above changes what is waiting —
 * paying a host clears an unpayable one, retrying a notification clears a
 * failed one — so counting first would report a queue the same run had already
 * emptied.
 */
async function reportWhatIsWaiting(now: Date): Promise<{ waiting: number }> {
  const to = safetyRecipient();
  if (!to) return { waiting: 0 };

  const admin = supabaseAdmin();

  /*
   * Every predicate here is the one the staff screen already uses, copied
   * rather than reinvented. The first version of this guessed four of the six
   * column names and every guess was wrong — which a count query reports as
   * zero, so the alerting would have stayed silent about exactly the things it
   * was built to raise. A monitor that fails quietly is worse than none.
   */
  const [financial, unpayable, refunds, claims, escalations, listings, changes, failed] =
    await Promise.all([
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("financial_resolution_state", "manual_review"),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("account_type", "host")
      .or("stripe_connect_account_id.is.null,stripe_connect_charges_enabled.is.false"),
    admin
      .from("refund_requests")
      .select("id", { count: "exact", head: true })
      .in("state", ["awaiting_host", "awaiting_staff"]),
    admin
      .from("studio_claims")
      .select("id", { count: "exact", head: true })
      .in("state", ["awaiting_practitioner", "awaiting_staff"]),
    admin
      .from("review_escalations")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),
    admin.from("spaces").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin
      .from("account_type_change_requests")
      .select("id", { count: "exact", head: true })
      .eq("state", "open"),
    // Tried, unsent, and carrying an error — the same three conditions the
    // staff screen calls a failed notification.
    admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("sent_at", null)
      .not("last_error", "is", null),
    ]);

  for (const result of [
    financial,
    unpayable,
    refunds,
    claims,
    escalations,
    listings,
    changes,
    failed,
  ]) {
    if (result.error) throw result.error;
  }

  const items = waitingOn({
    financialManualReview: financial.count ?? 0,
    unpayableHosts: unpayable.count ?? 0,
    openDisputes: (refunds.count ?? 0) + (claims.count ?? 0),
    escalations: escalations.count ?? 0,
    pendingListings: listings.count ?? 0,
    accountChangeRequests: changes.count ?? 0,
    failedNotifications: failed.count ?? 0,
  });

  if (items.length === 0) return { waiting: 0 };

  await notify({
    kind: "staff_waiting",
    // Not a user row: the operator is an address in ADMIN_EMAILS, and there
    // is no account to carry preferences. Alert switches would not apply to a
    // queue anyway — it is the person who runs the place.
    recipient: { userId: null, email: to },
    /*
     * The fingerprint is the subject id, which is what makes the dedupe do the
     * right thing on its own: an unchanged queue produces the same key and the
     * second send is dropped, anything new changes it and gets through, and the
     * date inside it raises a queue nobody has dealt with again tomorrow rather
     * than once and never.
     */
    subjectId: waitingSignature(items, now),
    context: {
      summary: subjectFor(items),
      items: items.map((item) => `  • ${item.line}`).join("\n"),
      queueUrl: `${siteUrl()}/admin`,
    },
  });

  return { waiting: items.length };
}
