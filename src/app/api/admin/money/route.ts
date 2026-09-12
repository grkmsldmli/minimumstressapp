import { adminGet } from "@/lib/admin/guard";
import { loadReportingQueue } from "@/lib/admin/reporting-truth";
import { moneyView } from "@/lib/admin/sections";

/**
 * Money: booking volume vs host earnings vs platform revenue, kept as three
 * distinct figures; refunds are netted and payout warnings only refer to due
 * sessions. Projected from the same audited reporting boundary as Command.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => moneyView(await loadReportingQueue(admin)));
}
