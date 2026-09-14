import { commandView } from "@/lib/admin/command";
import { loadEmailDeliveryEvidence } from "@/lib/admin/email-delivery";
import { loadAnalyticsSnapshot } from "@/lib/admin/analytics-snapshot";
import { adminGet } from "@/lib/admin/guard";
import { loadReportingQueueResult } from "@/lib/admin/reporting-truth";
import {
  probeCoreSystemHealth,
  productionSystemHealthDependencies,
} from "@/lib/admin/system-health";
import { emailConfigured, emailWebhookConfigured } from "@/lib/notify/transports";

/**
 * The Command home summary — KPIs, health, the ranked needs-attention list, and
 * the live/activity slices — projected from the audited reporting boundary.
 * Staff-gated by adminGet; a compact projection so the header and home can poll
 * it cheaply.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => {
    const [reporting, coreHealth, analytics, emailDelivery] = await Promise.all([
      loadReportingQueueResult(admin),
      probeCoreSystemHealth(productionSystemHealthDependencies(admin)),
      loadAnalyticsSnapshot(admin),
      loadEmailDeliveryEvidence(admin),
    ]);

    return commandView(reporting.queue, {
      coreHealth,
      reportingCheckedAt: reporting.checkedAt,
      notificationsConfigured: emailConfigured(),
      emailWebhookConfigured: emailWebhookConfigured(),
      emailDelivery,
      analytics,
    });
  });
}
