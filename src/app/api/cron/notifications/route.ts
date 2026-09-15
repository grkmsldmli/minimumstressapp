import type { NextRequest } from "next/server";

import { stripeGateway } from "@/lib/api/stripe-gateway";
import { retryFinancialResolutions } from "@/lib/financial-resolution";
import {
  notifyAccessCodesReady,
  reconcileCancellationNotifications,
  reconcileRequestOutcomeNotifications,
} from "@/lib/notify/for-booking";
import { retryPending } from "@/lib/notify/send";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The small, frequent notification worker.
 *
 * Payouts and retention stay on the slower operational cron. Door codes and
 * retries cannot: a twice-daily schedule misses almost every access window.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return new Response("Not configured", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
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
  const [cancellations, requestOutcomes, access, retries] = await Promise.allSettled([
    reconcileCancellationNotifications(admin, now),
    reconcileRequestOutcomeNotifications(admin, now),
    notifyAccessCodesReady(admin, now),
    retryPending(),
  ]);

  const failures: string[] = [];
  if (financial.status === "rejected") failures.push("financialResolutions");
  if (cancellations.status === "rejected") failures.push("cancellations");
  if (requestOutcomes.status === "rejected") failures.push("requestOutcomes");
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
      ...(cancellations.status === "fulfilled"
        ? { cancellationsReconciled: cancellations.value.reconciled }
        : {}),
      ...(requestOutcomes.status === "fulfilled"
        ? { requestOutcomesReconciled: requestOutcomes.value.reconciled }
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
