import { describe, expect, it } from "vitest";

import type { AdminQueue } from "./queue";
import { moneyView, systemView } from "./sections";

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
    money: { platformCents: 12000, hostCents: 80000, grossCents: 100000, platformAllTimeCents: 50000 },
    counts: {
      activeListings: 4,
      pendingListings: 1,
      practitioners: 10,
      hosts: 3,
      sessionsThisMonth: 7,
      upcomingSessions: 2,
      hostsUnpaid: 5,
    },
    bookingsByDay: [{ day: "2026-09-01", bookings: 2 }],
    recent: [],
    failedNotifications: [{ id: "n1", kind: "door_code", channel: "email", attempts: 3, lastError: "bounced", givenUp: true, createdAt: "2026-09-01" } as never],
    atRisk: [],
    people: [],
    listings: [],
    reviewReasons: [],
    listingGaps: [],
    funnel: [],
    moneyByDay: [{ day: "2026-09-01", platformCents: 1200, grossCents: 10000 }],
    termsOutstanding: 6,
    activity: [],
    ...overrides,
  };
}

describe("moneyView", () => {
  it("keeps the three figures distinct and never sums them", () => {
    const v = moneyView(baseQueue());
    expect(v.month.platformCents).toBe(12000);
    expect(v.month.hostCents).toBe(80000);
    expect(v.month.grossCents).toBe(100000);
    // The three are separate — platform + host must not equal the reported gross
    // by construction here, and the view exposes them individually.
    expect(v.month.platformCents).not.toBe(v.month.grossCents);
    expect(v.allTime.platformCents).toBe(50000);
    expect(v.hostsUnpaid).toBe(5);
    expect(v.byDay).toHaveLength(1);
  });
});

describe("systemView", () => {
  it("carries measured counts and the outbox failures", () => {
    const v = systemView(baseQueue());
    expect(v.counts.practitioners).toBe(10);
    expect(v.termsOutstanding).toBe(6);
    expect(v.failedNotifications).toHaveLength(1);
    // Health comes from the shared derivation — a given-up message raises it.
    expect(v.health.find((h) => h.key === "notifications")!.state).toBe("attention");
  });
});
