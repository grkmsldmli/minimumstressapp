import { commandView } from "@/lib/admin/command";
import { adminGet } from "@/lib/admin/guard";
import { loadQueue } from "@/lib/admin/queue";

/**
 * The Command home summary — KPIs, health, the ranked needs-attention list, and
 * the live/activity slices — projected from the one queue read. Staff-gated by
 * adminGet; a compact projection so the header and home can poll it cheaply.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => commandView(await loadQueue(admin)));
}
