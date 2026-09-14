import { describe, expect, it, vi } from "vitest";

const { checkedAt } = vi.hoisted(() => ({
  checkedAt: "2026-09-14T12:00:00.000Z",
}));

vi.mock("@/lib/admin/guard", () => ({
  adminGet: async (build: (admin: object) => Promise<unknown>) =>
    Response.json(await build({})),
}));
vi.mock("@/lib/admin/reporting-truth", () => ({
  loadReportingQueueResult: async () => ({
    available: false,
    queue: null,
    checkedAt,
  }),
}));
vi.mock("@/lib/admin/email-delivery", () => ({
  loadEmailDeliveryEvidence: async () => ({
    available: true,
    checkedAt,
    lastEventAt: null,
    lastEventType: null,
  }),
}));
vi.mock("@/lib/admin/system-health", () => ({
  productionSystemHealthDependencies: () => ({}),
  probeCoreSystemHealth: async () => [
    { key: "database", label: "Database", state: "healthy", checkedAt },
    { key: "auth", label: "Auth", state: "healthy", checkedAt },
  ],
}));
vi.mock("@/lib/admin/analytics-snapshot", () => ({
  loadAnalyticsSnapshot: async () => ({
    available: true,
    websiteSessionsToday: 2,
    appOpensToday: 1,
    lastEventAt: checkedAt,
    truncated: false,
  }),
}));
vi.mock("@/lib/notify/transports", () => ({
  emailConfigured: () => true,
  emailWebhookConfigured: () => true,
}));

import { GET } from "./route";

describe("GET /api/admin/command", () => {
  it("returns health and marks reporting values unavailable instead of zero", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reportingAvailable).toBe(false);
    expect(body.urgentCount).toBeNull();
    expect(body.queuesClear).toBeNull();
    expect(body.queuesTotal).toBeNull();
    expect(body.health).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "database", state: "healthy" }),
        expect.objectContaining({ key: "reporting_data", state: "critical" }),
        expect.objectContaining({
          key: "notifications",
          state: "unknown",
          note: "Configured · waiting for delivery test · queue unavailable",
        }),
      ]),
    );
    expect(
      body.kpis.find((item: { key: string }) => item.key === "platform_month").value,
    ).toBeNull();
    expect(
      body.kpis.find((item: { key: string }) => item.key === "visitors_today").value,
    ).toBe(2);
  });
});
