"use client";

import { apiFetch } from "../api-fetch";

export type MarketingActivity = "app_opened" | "space_browsed";

const recorded = new Set<MarketingActivity>();
let lastBrowseAt = 0;

/** Best-effort, identifier-free activity, called only while marketing is opted in. */
export async function recordMarketingActivity(event: MarketingActivity): Promise<boolean> {
  if (event === "app_opened" && recorded.has(event)) return true;
  if (event === "space_browsed" && Date.now() - lastBrowseAt < 5 * 60_000) return true;

  if (event === "app_opened") recorded.add(event);
  else lastBrowseAt = Date.now();

  try {
    const response = await apiFetch("/api/marketing/activity", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
    });
    if (!response.ok) {
      if (event === "app_opened") recorded.delete(event);
      else lastBrowseAt = 0;
    }
    return response.ok;
  } catch {
    if (event === "app_opened") recorded.delete(event);
    else lastBrowseAt = 0;
    return false;
  }
}

export function resetMarketingActivityForTests(): void {
  recorded.clear();
  lastBrowseAt = 0;
}
