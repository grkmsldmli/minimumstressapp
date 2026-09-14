import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizeAnalytics } from "./analytics-snapshot";

describe("summarizeAnalytics", () => {
  it("counts website sessions and app opens distinctly", () => {
    const summary = summarizeAnalytics([
      { event_name: "app_opened", occurred_at: "2026-09-14T12:00:00Z", session_id: "app-2", platform: "ios" },
      { event_name: "app_opened", occurred_at: "2026-09-14T11:30:00Z", session_id: "app-2", platform: "ios" },
      { event_name: "page_viewed", occurred_at: "2026-09-14T11:00:00Z", session_id: "site-1", platform: "site_web" },
      { event_name: "page_viewed", occurred_at: "2026-09-14T10:00:00Z", session_id: "site-1", platform: "site_web" },
      { event_name: "app_opened", occurred_at: "2026-09-14T09:00:00Z", session_id: "app-1", platform: "app_web" },
    ]);

    expect(summary.websiteSessionsToday).toBe(1);
    expect(summary.appOpensToday).toBe(2);
    expect(summary.lastEventAt).toBe("2026-09-14T12:00:00Z");
  });

  it("does not mix app screens into website traffic or server facts into opens", () => {
    const summary = summarizeAnalytics([
      { event_name: "page_viewed", occurred_at: "2026-09-14T11:00:00Z", session_id: "app-1", platform: "app_web" },
      { event_name: "payment_succeeded", occurred_at: "2026-09-14T10:00:00Z", session_id: "site-1", platform: "site_web" },
    ]);

    expect(summary.websiteSessionsToday).toBe(0);
    expect(summary.appOpensToday).toBe(0);
  });
});
