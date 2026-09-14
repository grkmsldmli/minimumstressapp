import { adminGet } from "@/lib/admin/guard";
import { loadEmailDeliveryEvidence } from "@/lib/admin/email-delivery";
import { loadReportingQueueResult } from "@/lib/admin/reporting-truth";
import { systemView } from "@/lib/admin/sections";
import {
  probeCoreSystemHealth,
  productionSystemHealthDependencies,
} from "@/lib/admin/system-health";
import { emailConfigured, emailWebhookConfigured } from "@/lib/notify/transports";

/**
 * System: measurable health only (unknown where there is no probe), the audited
 * account/booking/listing counts, terms acceptance outstanding, and notification
 * outbox failures. Nothing invented — a metric we cannot measure is not green.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => {
    const [reporting, coreHealth, emailDelivery] = await Promise.all([
      loadReportingQueueResult(admin),
      probeCoreSystemHealth(productionSystemHealthDependencies(admin)),
      loadEmailDeliveryEvidence(admin),
    ]);
    return systemView(reporting.queue, {
      coreHealth,
      reportingCheckedAt: reporting.checkedAt,
      notificationsConfigured: emailConfigured(),
      emailWebhookConfigured: emailWebhookConfigured(),
      emailDelivery,
    });
  });
}
