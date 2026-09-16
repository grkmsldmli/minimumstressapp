import type { NextRequest } from "next/server";

import { stripeGateway } from "@/lib/api/stripe-gateway";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { retryFinancialResolutions } from "@/lib/financial-resolution";
import { processMarketingOutbox } from "@/lib/marketing/outbox";
import { executeMoneyOperation } from "@/lib/money-operation-service";
import { claimMoneyOperationRetries } from "@/lib/money-operations";
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
import { retryPending } from "@/lib/notify/send";
import {
  notifyReviewRequests,
  reconcileReviewLifecycleNotifications,
} from "@/lib/notify/for-review";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The small, frequent notification worker.
 *
 * Moving payout money and retention stay on the slower operational cron.
 * Receipt reconciliation, door codes and retries cannot: a twice-daily
 * schedule leaves avoidable notification gaps after a process crash.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const authorization = await authorizeCronRequest(request);
  if (!authorization.ok) {
    return new Response(authorization.message, { status: authorization.status });
  }

  const now = new Date();
  const admin = supabaseAdmin();

  // Money facts first. Cancellation and request receipts are database-gated
  // on this result, so even if the stages below overlap they cannot outrun a
  // pending Stripe refund or hold release.
  const financial = await retryFinancialResolutions(admin, stripeGateway, 50, now)
    .then((value) => ({ status: "fulfilled" as const, value }))
    .catch(() => ({ status: "rejected" as const }));

  // Each stage gets its own failure boundary. A temporary cancellation-query
  // error must not also block a door code or the entire retry queue.
  const [
    moneyOperations,
    bookingConfirmations,
    cancellations,
    requestSubmissions,
    requestOutcomes,
    refundRequests,
    refundDecisions,
    payouts,
    messageJobs,
    reviewNudges,
    reviewLifecycle,
    marketing,
    access,
    retries,
  ] =
    await Promise.allSettled([
      retryDueMoneyOperations(admin, now),
      reconcileBookingConfirmationNotifications(admin, now),
      reconcileCancellationNotifications(admin, now),
      reconcileRequestSubmissionNotifications(admin, now),
      reconcileRequestOutcomeNotifications(admin, now),
      reconcileRefundRequestNotifications(admin, now),
      reconcileRefundDecisionNotifications(admin, now),
      reconcileHostPayoutNotifications(admin, now),
      processMessageNotificationJobs(admin, { now }),
      notifyReviewRequests(admin, now),
      reconcileReviewLifecycleNotifications(admin, now),
      processMarketingOutbox(admin, { now, limit: 50 }),
      notifyAccessCodesReady(admin, now),
      retryPending(),
    ]);

  const failures: string[] = [];
  if (financial.status === "rejected") failures.push("financialResolutions");
  if (moneyOperations.status === "rejected") failures.push("moneyOperations");
  if (bookingConfirmations.status === "rejected") failures.push("bookingConfirmations");
  if (cancellations.status === "rejected") failures.push("cancellations");
  if (requestSubmissions.status === "rejected") failures.push("requestSubmissions");
  if (requestOutcomes.status === "rejected") failures.push("requestOutcomes");
  if (refundRequests.status === "rejected") failures.push("refundRequests");
  if (refundDecisions.status === "rejected") failures.push("refundDecisions");
  if (payouts.status === "rejected") failures.push("payouts");
  if (messageJobs.status === "rejected") failures.push("messageJobs");
  if (reviewNudges.status === "rejected") failures.push("reviewNudges");
  if (reviewLifecycle.status === "rejected") failures.push("reviewLifecycle");
  if (marketing.status === "rejected") failures.push("marketing");
  if (access.status === "rejected") failures.push("access");
  if (retries.status === "rejected") failures.push("retries");

  if (failures.length) {
    console.error(`Frequent notification worker incomplete: ${failures.join(", ")}`);
  }

  return Response.json(
    {
      ranAt: now.toISOString(),
      ...(financial.status === "fulfilled"
        ? {
            financialResolutionsClaimed: financial.value.claimed,
            financialResolutionsCompleted: financial.value.resolved,
            financialResolutionsRetrying: financial.value.retrying,
            financialResolutionsManualReview: financial.value.manualReview,
          }
        : {}),
      ...(moneyOperations.status === "fulfilled"
        ? {
            moneyOperationsRetryClaimed: moneyOperations.value.claimed,
            moneyOperationsRetried: moneyOperations.value.retried,
            moneyOperationsRetryFailed: moneyOperations.value.failed,
          }
        : {}),
      ...(bookingConfirmations.status === "fulfilled"
        ? { bookingConfirmationsReconciled: bookingConfirmations.value.reconciled }
        : {}),
      ...(cancellations.status === "fulfilled"
        ? { cancellationsReconciled: cancellations.value.reconciled }
        : {}),
      ...(requestOutcomes.status === "fulfilled"
        ? { requestOutcomesReconciled: requestOutcomes.value.reconciled }
        : {}),
      ...(requestSubmissions.status === "fulfilled"
        ? { requestSubmissionsReconciled: requestSubmissions.value.reconciled }
        : {}),
      ...(refundRequests.status === "fulfilled"
        ? { refundRequestsReconciled: refundRequests.value.reconciled }
        : {}),
      ...(refundDecisions.status === "fulfilled"
        ? { refundDecisionsReconciled: refundDecisions.value.reconciled }
        : {}),
      ...(payouts.status === "fulfilled"
        ? { payoutReceiptsReconciled: payouts.value.reconciled }
        : {}),
      ...(messageJobs.status === "fulfilled"
        ? {
            messageJobsClaimed: messageJobs.value.claimed,
            messageJobsCompleted: messageJobs.value.completed,
            messageJobsRetrying: messageJobs.value.retrying,
            messageJobsFailed: messageJobs.value.failed,
          }
        : {}),
      ...(reviewNudges.status === "fulfilled"
        ? { reviewPrompts: reviewNudges.value.prompted, reviewReminders: reviewNudges.value.reminded }
        : {}),
      ...(reviewLifecycle.status === "fulfilled"
        ? {
            reviewReceipts: reviewLifecycle.value.submitted,
            counterpartReviews: reviewLifecycle.value.counterpart,
            reviewsPublished: reviewLifecycle.value.published,
          }
        : {}),
      ...(marketing.status === "fulfilled"
        ? {
            marketingClaimed: marketing.value.claimed,
            marketingSent: marketing.value.sent,
            marketingRetrying: marketing.value.retrying,
            marketingFailed: marketing.value.failed,
            marketingSuppressed: marketing.value.suppressed,
          }
        : {}),
      ...(access.status === "fulfilled"
        ? { accessCodesAnnounced: access.value.announced }
        : {}),
      ...(retries.status === "fulfilled"
        ? {
            notificationsRetried: retries.value.retried,
            notificationsSent: retries.value.sent,
            notificationsGivenUp: retries.value.givenUp,
          }
        : {}),
      ...(failures.length ? { error: "Notification worker incomplete", failedStages: failures } : {}),
    },
    { status: failures.length ? 500 : 200 },
  );
}

/**
 * Money-operation leases are short-lived, so retry them on the five-minute
 * worker rather than making a transient Stripe outage wait for the twice-daily
 * operational sweep. A failed operation is isolated from every other claimed
 * row and from all notification reconciliation stages above.
 */
async function retryDueMoneyOperations(
  admin: ReturnType<typeof supabaseAdmin>,
  now: Date,
): Promise<{ claimed: number; retried: number; failed: number }> {
  const operations = await claimMoneyOperationRetries(admin, 25, undefined, now);
  let retried = 0;
  let failed = 0;

  for (const operation of operations) {
    try {
      const result = await executeMoneyOperation(admin, operation, undefined, now);
      if (result.committed) retried += 1;
      else failed += 1;
    } catch (failure) {
      failed += 1;
      console.error(`Money-operation retry failed for ${operation.id}:`, failure);
    }
  }

  return { claimed: operations.length, retried, failed };
}
