import { commandView } from "@/lib/admin/command";
import { adminGet } from "@/lib/admin/guard";
import { loadReportingQueue } from "@/lib/admin/reporting-truth";

/**
 * The Command home summary — KPIs, health, the ranked needs-attention list, and
 * the live/activity slices — projected from the audited reporting boundary.
 * Staff-gated by adminGet; a compact projection so the header and home can poll
 * it cheaply.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => commandView(await loadReportingQueue(admin)));
}
