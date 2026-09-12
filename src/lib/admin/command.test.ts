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
    pendingCredentials: [],
    accountChangeRequests: [],
    unpayableHosts: [],
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

  it("marks uninstrumented KPIs as null, never a fake zero", () => {
    const v = commandView(baseQueue());
    expect(v.kpis.find((k) => k.key === "visitors_today")!.value).toBeNull();
    expect(v.kpis.find((k) => k.key === "app_opens_today")!.value).toBeNull();
  });
});

describe("deriveHealth", () => {
  it("reports only measurable health, unknown elsewhere", () => {
    const h = deriveHealth(baseQueue());
    const state = (k: string) => h.find((x) => x.key === k)!.state;
    expect(state("database")).toBe("healthy");
    expect(state("auth")).toBe("healthy");
    expect(state("notifications")).toBe("healthy");
    expect(state("stripe_payments")).toBe("unknown");
    expect(state("web_analytics")).toBe("unknown");
  });

  it("raises notifications to attention when a message gave up", () => {
    const h = deriveHealth(baseQueue({ failedNotifications: [{ givenUp: true } as never] }));
    const notif = h.find((x) => x.key === "notifications")!;
    expect(notif.state).toBe("attention");
    expect(notif.note).toContain("gave up");
  });
});
