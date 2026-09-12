import { adminGet } from "@/lib/admin/guard";
import { loadReportingQueue } from "@/lib/admin/reporting-truth";
import { systemView } from "@/lib/admin/sections";

/**
 * System: measurable health only (unknown where there is no probe), the audited
 * account/booking/listing counts, terms acceptance outstanding, and notification
 * outbox failures. Nothing invented — a metric we cannot measure is not green.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => systemView(await loadReportingQueue(admin)));
}
