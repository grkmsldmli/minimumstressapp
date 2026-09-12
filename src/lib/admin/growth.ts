import type { FunnelStep } from "./queue";

/**
 * Growth, told only from what is actually recorded.
 *
 * The funnel is real — it is computed from live rows. The analytics stream is
 * new: server-side product events land in analytics_events, and this counts
 * exactly what is there over a window. Web/app visitor analytics has no
 * collector yet and is reported as such rather than as a zero, so nobody reads
 * an empty chart as "no visitors" when it means "not measured".
 */

export interface RawEvent {
  event_name: string;
  occurred_at: string;
  session_id: string | null;
  anonymous_id: string | null;
  user_id: string | null;
}

export interface EventCount {
  name: string;
  count: number;
}

export interface GrowthView {
  funnel: FunnelStep[];
  windowDays: number;
  events: {
    total: number;
    distinctSessions: number;
    distinctUsers: number;
    byName: EventCount[];
  };
  /** Whether any product events have been recorded yet at all. */
  instrumented: boolean;
  /** Surfaces that have no collector — never shown as a zero. */
  notInstrumented: string[];
}

export function growthView(funnel: FunnelStep[], events: RawEvent[], windowDays = 30): GrowthView {
  const byName = new Map<string, number>();
  const sessions = new Set<string>();
  const users = new Set<string>();
  for (const e of events) {
    byName.set(e.event_name, (byName.get(e.event_name) ?? 0) + 1);
    if (e.session_id) sessions.add(e.session_id);
    if (e.user_id) users.add(e.user_id);
  }

  return {
    funnel,
    windowDays,
    events: {
      total: events.length,
      distinctSessions: sessions.size,
      distinctUsers: users.size,
      byName: [...byName.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    },
    instrumented: events.length > 0,
    notInstrumented: ["Website visitors", "App opens", "Screen views"],
  };
}
