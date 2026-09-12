import { adminGet } from "@/lib/admin/guard";
import { loadQueue } from "@/lib/admin/queue";
import { moneyView } from "@/lib/admin/sections";

/**
 * Money: booking volume vs host earnings vs platform revenue, kept as three
 * distinct figures; the 14-day trend; and the hosts who earned money that cannot
 * reach them. Projected from the one queue read so it agrees with Command.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => moneyView(await loadQueue(admin)));
}
