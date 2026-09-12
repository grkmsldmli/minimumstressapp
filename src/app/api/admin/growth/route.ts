import { adminGet } from "@/lib/admin/guard";
import { growthView, type RawEvent } from "@/lib/admin/growth";
import { loadQueue } from "@/lib/admin/queue";

const WINDOW_DAYS = 30;

/**
 * Growth: the live funnel, plus a truthful summary of the product-event stream
 * over the last 30 days. Surfaces with no collector are named as uninstrumented,
 * never charted as zero.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [q, eventsRes] = await Promise.all([
      loadQueue(admin),
      admin
        .from("analytics_events")
        .select("event_name, occurred_at, session_id, anonymous_id, user_id")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(10000),
    ]);
    return growthView(q.funnel, (eventsRes.data ?? []) as RawEvent[], WINDOW_DAYS);
  });
}
