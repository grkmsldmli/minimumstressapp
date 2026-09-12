import { adminGet } from "@/lib/admin/guard";
import { loadQueue } from "@/lib/admin/queue";
import { systemView } from "@/lib/admin/sections";

/**
 * System: measurable health only (unknown where there is no probe), the account
 * and listing counts, terms acceptance outstanding, and the notification outbox
 * failures. Nothing invented — a metric we cannot measure is not shown green.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => systemView(await loadQueue(admin)));
}
