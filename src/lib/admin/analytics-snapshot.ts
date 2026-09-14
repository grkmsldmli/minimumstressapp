import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_EVENTS_PER_DAY = 10_000;

export interface AnalyticsSnapshot {
  /** False means the read failed; null metrics must be shown, never fake zeroes. */
  available: boolean;
  websiteSessionsToday: number | null;
  appOpensToday: number | null;
  lastEventAt: string | null;
  truncated: boolean;
}

interface AnalyticsRow {
  event_name: string;
  occurred_at: string;
  session_id: string | null;
  platform: string | null;
}

export function summarizeAnalytics(rows: AnalyticsRow[]): Omit<AnalyticsSnapshot, "available"> {
  const websiteSessions = new Set<string>();
  const appOpenSessions = new Set<string>();

  for (const row of rows) {
    if (row.event_name === "page_viewed" && row.platform === "site_web" && row.session_id) {
      websiteSessions.add(row.session_id);
    }
    if (
      row.event_name === "app_opened"
      && row.session_id
      && (row.platform === "app_web" || row.platform === "ios" || row.platform === "android")
    ) {
      appOpenSessions.add(`${row.platform}:${row.session_id}`);
    }
  }

  return {
    websiteSessionsToday: websiteSessions.size,
    appOpensToday: appOpenSessions.size,
    lastEventAt: rows[0]?.occurred_at ?? null,
    truncated: rows.length >= MAX_EVENTS_PER_DAY,
  };
}

/**
 * Today's first-party product traffic, read independently of the core ops queue.
 *
 * A failed analytics read must not take the whole Command Center down, but it
 * also must never become a reassuring zero. The tagged result lets health turn
 * red while the KPI projection renders "unavailable" as null.
 */
export async function loadAnalyticsSnapshot(
  admin: SupabaseClient,
  now = new Date(),
): Promise<AnalyticsSnapshot> {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  try {
    const { data, error } = await admin
      .from("analytics_events")
      .select("event_name, occurred_at, session_id, platform")
      .in("event_name", ["page_viewed", "app_opened"])
      .gte("occurred_at", today.toISOString())
      .order("occurred_at", { ascending: false })
      .limit(MAX_EVENTS_PER_DAY);

    if (error) throw error;
    return { available: true, ...summarizeAnalytics((data ?? []) as AnalyticsRow[]) };
  } catch (error) {
    console.error("Admin analytics snapshot failed:", error);
    return {
      available: false,
      websiteSessionsToday: null,
      appOpensToday: null,
      lastEventAt: null,
      truncated: false,
    };
  }
}
