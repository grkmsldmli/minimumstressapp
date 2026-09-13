import { describe, expect, it } from "vitest";

import type { AdminQueue } from "./queue";
import {
  enforceReportingTruth,
  netBookingAmounts,
  type ReportingBookingRow,
} from "./reporting-truth";

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
    money: { platformCents: 999, hostCents: 999, grossCents: 999, platformAllTimeCents: 999 },
    counts: {
      activeListings: 1,
      pendingListings: 0,
      practitioners: 1,
      hosts: 1,
      sessionsThisMonth: 99,
      upcomingSessions: 99,
      hostsUnpaid: 99,
    },
    bookingsByDay: [],
    recent: [],
    failedNotifications: [],
    atRisk: [],
    people: [
      {
        id: "host",
        email: "host@example.com",
        accountType: "host",
        displayName: "Host",
        joinedAt: null,
        listings: 1,
        sessions: 99,
        lateCancellations: 0,
        payoutsReady: false,
        earnedCents: 999,
        spentCents: 0,
        emergency: { name: null, phone: null, relationship: null },
      },
      {
        id: "practitioner",
        email: "p@example.com",
        accountType: "practitioner",
        displayName: "P",
        joinedAt: null,
        listings: 0,
        sessions: 99,
        lateCancellations: 0,
        payoutsReady: null,
        earnedCents: 0,
        spentCents: 999,
        emergency: { name: null, phone: null, relationship: null },
      },
    ],
    listings: [
      {
        id: "space",
        name: "Room",
        status: "active",
        category: "movement",
        hourlyRateCents: 8000,
        hostEmail: "host@example.com",
        addressLine: null,
        sessions: 99,
        earnedCents: 999,
        createdAt: null,
        archivedAt: null,
      },
    ],
    reviewReasons: [],
    listingGaps: [],
    funnel: [
      { label: "Signed up", count: 2 },
      { label: "Listings booked", count: 99 },
    ],
    moneyByDay: [{ day: "2026-09-11", platformCents: 999, grossCents: 999 }],
    termsOutstanding: 0,
    activity: [],
    ...overrides,
  };
}

function row(overrides: Partial<ReportingBookingRow> = {}): ReportingBookingRow {
  return {
    id: "booking",
    space_id: "space",
    practitioner_id: "practitioner",
    starts_at: "2026-09-11T18:00:00.000Z",
    status: "upcoming",
    captured_at: "2026-09-01T12:00:00.000Z",
    cancelled_at: null,
    refunded_cents: 0,
    host_rate_refunded: false,
    host_paid_at: null,
    total_cents: 10000,
    host_rate_cents: 8000,
    platform_cents: 2000,
    ...overrides,
  };
}

const spaces = [{ id: "space", host_id: "host" }];
const now = new Date("2026-09-11T20:00:00.000Z");

describe("netBookingAmounts", () => {
  it("nets a platform-fee refund without erasing host earnings", () => {
    expect(netBookingAmounts(row({ refunded_cents: 2000 }))).toEqual({
      grossCents: 8000,
      hostCents: 8000,
      platformCents: 0,
    });
  });

  it("nets a full refund to zero", () => {
    expect(
      netBookingAmounts(row({ refunded_cents: 10000, host_rate_refunded: true })),
    ).toEqual({ grossCents: 0, hostCents: 0, platformCents: 0 });
  });
});

describe("enforceReportingTruth", () => {
  it("removes abandoned checkout cancellations from activity, funnel and live sessions", () => {
    const abandoned = row({
      id: "attempt",
      captured_at: null,
      status: "cancelled_by_practitioner",
      cancelled_at: "2026-09-10T20:00:00.000Z",
    });
    const queue = baseQueue({
      activity: [
        {
          id: "cancel-attempt",
          at: abandoned.cancelled_at!,
          kind: "cancellation",
          text: "Room — cancelled by the practitioner",
        },
      ],
      liveSessions: [
        {
          bookingId: "attempt",
          spaceName: "Room",
          addressLine: null,
          startsAt: abandoned.starts_at,
          endsAt: "2026-09-11T19:00:00.000Z",
          state: "in progress",
          practitioner: { id: "practitioner", name: null, email: null, emergency: { name: null, phone: null, relationship: null } },
          host: { id: "host", name: null, email: null, emergency: { name: null, phone: null, relationship: null } },
        },
      ],
    });

    const out = enforceReportingTruth(queue, [abandoned], spaces, now);
    expect(out.activity).toEqual([]);
    expect(out.liveSessions).toEqual([]);
    expect(out.funnel.find((s) => s.label === "Listings booked")?.count).toBe(0);
    expect(out.counts.sessionsThisMonth).toBe(0);
    expect(out.money.grossCents).toBe(0);
  });

  it("stops this-month metrics at the next month boundary", () => {
    const september = row({ id: "sep", starts_at: "2026-09-20T18:00:00.000Z" });
    const october = row({ id: "oct", starts_at: "2026-10-02T18:00:00.000Z" });
    const out = enforceReportingTruth(baseQueue(), [september, october], spaces, now);
    expect(out.counts.sessionsThisMonth).toBe(1);
    expect(out.money.grossCents).toBe(10000);
    expect(out.money.platformCents).toBe(2000);
  });

  it("only marks completed/due host money as unpayable", () => {
    const past = row({ id: "past", starts_at: "2026-09-10T18:00:00.000Z" });
    const future = row({ id: "future", starts_at: "2026-09-20T18:00:00.000Z" });
    const refunded = row({
      id: "refunded",
      starts_at: "2026-09-09T18:00:00.000Z",
      refunded_cents: 10000,
      host_rate_refunded: true,
    });
    const out = enforceReportingTruth(baseQueue(), [past, future, refunded], spaces, now);
    expect(out.counts.hostsUnpaid).toBe(1);
    expect(out.unpayableHosts).toHaveLength(1);
    expect(out.unpayableHosts[0].owedSessions).toBe(1);
    expect(out.unpayableHosts[0].owedCents).toBe(8000);
  });

  it("recomputes person and listing money net of refunds", () => {
    const feeRefund = row({ refunded_cents: 2000 });
    const out = enforceReportingTruth(baseQueue(), [feeRefund], spaces, now);
    expect(out.people.find((p) => p.id === "practitioner")?.spentCents).toBe(8000);
    expect(out.people.find((p) => p.id === "host")?.earnedCents).toBe(8000);
    expect(out.listings[0].earnedCents).toBe(8000);
  });
});
