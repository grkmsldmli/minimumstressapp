import { describe, expect, it } from "vitest";

import { commandView, deriveHealth } from "./command";
import type { AdminQueue } from "./queue";

/**
 * commandView is what the founder home and the shell's urgent badge read, so its
 * ranking, its "all clear" collapse, and above all its refusal to invent a
 * number are pinned here.
 */
function baseQueue(overrides: Partial<AdminQueue> = {}): AdminQueue {
  return {
    liveSessions: [],
    openDisputes: [],
    escalations: [],
    pendingListings: [],
    pendingInsurance: [],
    pendingSpaceInsurance: [],
    pendingCredentials: [],
    accountChangeRequests: [],
    listingClosureRequests: [],
    unpayableHosts: [],
    financialManualReview: [],
    money: { platformCents: 12000, hostCents: 80000, grossCents: 100000, platformAllTimeCents: 50000 },
    counts: {
      activeListings: 4,
      pendingListings: 0,
      practitioners: 10,
      hosts: 3,
      sessionsThisMonth: 7,
      upcomingSessions: 2,
      hostsUnpaid: 0,
    },
    bookingsByDay: [],
    recent: [],
    failedNotifications: [],
    atRisk: [],
    people: [],
    listings: [],
    reviewReasons: [],
    listingGaps: [],
    funnel: [],
    moneyByDay: [],
    termsOutstanding: 0,
    activity: [],
    ...overrides,
  };
}

describe("commandView", () => {
  it("collapses to all-clear when nothing is waiting", () => {
    const v = commandView(baseQueue());
    expect(v.urgentCount).toBe(0);
    expect(v.needsAttention).toEqual([]);
    expect(v.queuesClear).toBe(true);
    expect(v.queuesTotal).toBeGreaterThan(0);
  });

  it("surfaces permanent closure requests in Command", () => {
    const view = commandView(
      baseQueue({ listingClosureRequests: [{ id: "close-1" } as never] }),
    );
    expect(view.needsAttention).toContainEqual(
      expect.objectContaining({ key: "listing_closures", count: 1 }),
    );
    expect(view.queuesClear).toBe(false);
  });

  it("surfaces space insurance waiting for review", () => {
    const view = commandView(
      baseQueue({ pendingSpaceInsurance: [{ id: "sp-1" } as never, { id: "sp-2" } as never] }),
    );
    expect(view.needsAttention).toContainEqual(
      expect.objectContaining({ key: "space_insurance", count: 2 }),
    );
    expect(view.queuesClear).toBe(false);
  });

  it("counts urgent as the safety+money slice and lists what is waiting", () => {
    const v = commandView(
      baseQueue({
        escalations: [{ id: "e1" } as never],
        openDisputes: [
          { waitingOn: "us" } as never,
          { waitingOn: "the other side" } as never,
        ],
        unpayableHosts: [{ id: "h1" } as never],
        failedNotifications: [
          { givenUp: true } as never,
          { givenUp: false } as never,
        ],
        pendingListings: [{ id: "l1" } as never],
      }),
    );
    // 1 escalation + 1 dispute-on-us + 1 unpayable + 1 failed-given-up
    expect(v.urgentCount).toBe(4);
    expect(v.queuesClear).toBe(false);
    // The pending listing is waiting but not "urgent".
    const keys = v.needsAttention.map((a) => a.key);
    expect(keys).toContain("safety");
    expect(keys).toContain("disputes");
    expect(keys).toContain("listings");
    // Safety is ranked first.
    expect(v.needsAttention[0].key).toBe("safety");
  });

  it("maps the money KPIs and never conflates the three figures", () => {
    const v = commandView(baseQueue());
    const kpi = (k: string) => v.kpis.find((x) => x.key === k)!;
    expect(kpi("platform_month").value).toBe(12000);
    expect(kpi("gmv_month").value).toBe(100000);
    expect(kpi("host_month").value).toBe(80000);
    expect(kpi("platform_all").value).toBe(50000);
  });

  it("marks unavailable analytics KPIs as null, never a fake zero", () => {
    const v = commandView(baseQueue());
    expect(v.kpis.find((k) => k.key === "visitors_today")!.value).toBeNull();
    expect(v.kpis.find((k) => k.key === "app_opens_today")!.value).toBeNull();
  });

  it("shows real first-party analytics values, including an honest zero", () => {
    const v = commandView(baseQueue(), {
      analytics: {
        available: true,
        websiteSessionsToday: 4,
        appOpensToday: 0,
        truncated: false,
      },
    });
    expect(v.kpis.find((k) => k.key === "visitors_today")!.value).toBe(4);
    expect(v.kpis.find((k) => k.key === "app_opens_today")!.value).toBe(0);
  });
});

describe("deriveHealth", () => {
  it("never invents a green state when live evidence was not supplied", () => {
    const h = deriveHealth(baseQueue());
    const state = (k: string) => h.find((x) => x.key === k)!.state;
    expect(state("database")).toBe("unknown");
    expect(state("auth")).toBe("unknown");
    expect(state("notifications")).toBe("unknown");
    expect(state("stripe_payments")).toBe("unknown");
    expect(state("web_analytics")).toBe("unknown");
  });

  it("does not call configured email healthy before the first signed receipt", () => {
    const checkedAt = "2026-09-14T12:00:00.000Z";
    const h = deriveHealth(baseQueue(), {
      notificationsConfigured: true,
      emailWebhookConfigured: true,
      emailDelivery: {
        available: true,
        checkedAt,
        lastEventAt: null,
        lastEventType: null,
      },
      coreHealth: [
        { key: "database", label: "Database", state: "healthy", checkedAt },
        { key: "auth", label: "Auth", state: "healthy", checkedAt },
        { key: "stripe_payments", label: "Stripe payments", state: "healthy", checkedAt },
        { key: "stripe_payouts", label: "Stripe Connect payouts", state: "healthy", checkedAt },
        { key: "web_analytics", label: "Web analytics", state: "unknown", note: "Waiting for first event", checkedAt },
      ],
    });
    const state = (key: string) => h.find((item) => item.key === key)!.state;
    expect(state("database")).toBe("healthy");
    expect(state("auth")).toBe("healthy");
    expect(state("reporting_data")).toBe("healthy");
    expect(state("notifications")).toBe("unknown");
    expect(h.find((item) => item.key === "notifications")!.note).toBe(
      "Configured · waiting for delivery test",
    );
    expect(state("stripe_payments")).toBe("healthy");
    expect(state("web_analytics")).toBe("unknown");
  });

  it("turns email healthy only from a fresh signed delivered event", () => {
    const checkedAt = "2026-09-14T12:00:00.000Z";
    const h = deriveHealth(baseQueue(), {
      notificationsConfigured: true,
      emailWebhookConfigured: true,
      emailDelivery: {
        available: true,
        checkedAt,
        lastEventAt: "2026-09-14T11:59:00.000Z",
        lastEventType: "email.delivered",
      },
    });

    expect(h.find((item) => item.key === "notifications")).toMatchObject({
      state: "healthy",
      note: "Delivery verified",
      lastSeenAt: "2026-09-14T11:59:00.000Z",
    });
  });

  it.each([
    ["email.failed", "Latest email failed"],
    ["email.bounced", "Latest email bounced"],
    ["email.complained", "Latest email marked as spam"],
  ] as const)("degrades email for a fresh signed %s event", (lastEventType, note) => {
    const h = deriveHealth(baseQueue(), {
      notificationsConfigured: true,
      emailWebhookConfigured: true,
      emailDelivery: {
        available: true,
        checkedAt: "2026-09-14T12:00:00.000Z",
        lastEventAt: "2026-09-14T11:59:00.000Z",
        lastEventType,
      },
    });

    expect(h.find((item) => item.key === "notifications")).toMatchObject({
      state: "attention",
      note,
    });
  });

  it("expires old positive evidence instead of leaving a permanent green", () => {
    const h = deriveHealth(baseQueue(), {
      notificationsConfigured: true,
      emailWebhookConfigured: true,
      emailDelivery: {
        available: true,
        checkedAt: "2026-09-14T12:00:00.000Z",
        lastEventAt: "2026-08-01T12:00:00.000Z",
        lastEventType: "email.delivered",
      },
    });

    expect(h.find((item) => item.key === "notifications")).toMatchObject({
      state: "unknown",
      note: "No delivery event in 30 days",
    });
  });

  it("raises notifications to attention when a message gave up", () => {
    const h = deriveHealth(
      baseQueue({ failedNotifications: [{ givenUp: true } as never] }),
      {
        notificationsConfigured: true,
        emailWebhookConfigured: true,
        emailDelivery: {
          available: true,
          checkedAt: "2026-09-14T12:00:00.000Z",
          lastEventAt: "2026-09-14T11:59:00.000Z",
          lastEventType: "email.delivered",
        },
      },
    );
    const notif = h.find((x) => x.key === "notifications")!;
    expect(notif.state).toBe("attention");
    expect(notif.note).toContain("permanently failed");
  });

  it("raises payout health to attention for blocked hosts even when the provider probe is unknown", () => {
    const h = deriveHealth(
      baseQueue({ unpayableHosts: [{ id: "host-1" } as never] }),
      {
        coreHealth: [
          {
            key: "stripe_payouts",
            label: "Stripe Connect payouts",
            state: "unknown",
            note: "Configured · delivery unverified",
          },
        ],
      },
    );
    expect(h.find((item) => item.key === "stripe_payouts")).toMatchObject({
      state: "attention",
      note: "1 host cannot receive payouts",
    });
  });

  it("makes an unresolved booking payment critical and actionable", () => {
    const queue = baseQueue({
      financialManualReview: [{ id: "booking-1" } as never],
    });
    const health = deriveHealth(queue, {
      coreHealth: [
        {
          key: "stripe_payments",
          label: "Stripe payments",
          state: "healthy",
        },
      ],
    });

    expect(health.find((item) => item.key === "stripe_payments")).toMatchObject({
      state: "critical",
      note: "1 booking payment needs manual review",
    });
    expect(commandView(queue).needsAttention[0]).toMatchObject({
      key: "financial",
      count: 1,
    });
  });

  it("keeps health visible while marking reporting KPIs and queues unavailable", () => {
    const view = commandView(null, {
      coreHealth: [
        { key: "database", label: "Database", state: "healthy" },
        { key: "auth", label: "Auth", state: "healthy" },
      ],
      analytics: {
        available: true,
        websiteSessionsToday: 3,
        appOpensToday: 2,
        truncated: false,
      },
    });

    expect(view.reportingAvailable).toBe(false);
    expect(view.urgentCount).toBeNull();
    expect(view.queuesClear).toBeNull();
    expect(view.queuesTotal).toBeNull();
    expect(view.needsAttention).toEqual([]);
    expect(view.health.find((item) => item.key === "database")!.state).toBe(
      "healthy",
    );
    expect(view.health.find((item) => item.key === "reporting_data")!.state).toBe(
      "critical",
    );
    expect(view.kpis.find((item) => item.key === "platform_month")!.value).toBeNull();
    expect(view.kpis.find((item) => item.key === "visitors_today")!.value).toBe(3);
  });
});
