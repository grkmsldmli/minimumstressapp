import { describe, expect, it } from "vitest";

import type { DirPerson } from "./directory";
import { type RawWorkInterest, type RawWorkRequest, workView } from "./work-view";

const people: DirPerson[] = [
  {
    id: "host-1",
    email: "hana@example.com",
    displayName: "Hana Host",
    accountType: "host",
    joinedAt: null,
    listings: 1,
    sessions: 0,
    earnedCents: 0,
    spentCents: 0,
    lateCancellations: 0,
    suspended: false,
    payoutsReady: true,
    emergency: { name: null, phone: null, relationship: null },
  },
];

const requests: RawWorkRequest[] = [
  { id: "r1", host_id: "host-1", title: "Cover Monday yoga", profession: "yoga", starts_at: "2026-09-10T09:00:00Z", ends_at: "2026-09-10T10:00:00Z", pay_cents: 6000, urgent: true, state: "open", created_at: "2026-09-01", filled_at: null },
  { id: "r2", host_id: "host-1", title: "Filled slot", profession: "pilates", starts_at: "2026-09-11T09:00:00Z", ends_at: "2026-09-11T10:00:00Z", pay_cents: 5000, urgent: false, state: "filled", created_at: "2026-09-01", filled_at: "2026-09-05" },
  { id: "r3", host_id: "host-1", title: "Old expired", profession: null, starts_at: "2026-08-01T09:00:00Z", ends_at: "2026-08-01T10:00:00Z", pay_cents: 4000, urgent: false, state: "expired", created_at: "2026-07-01", filled_at: null },
];

const interest: RawWorkInterest[] = [
  { request_id: "r1", state: "interested" },
  { request_id: "r1", state: "interested" },
  { request_id: "r2", state: "confirmed" },
  { request_id: "r2", state: "declined" },
];

describe("workView", () => {
  it("counts the board by state and lists open, uncovered requests", () => {
    const v = workView(requests, interest, people);
    expect(v.counts.total).toBe(3);
    expect(v.counts.open).toBe(1);
    expect(v.counts.filled).toBe(1);
    expect(v.counts.expired).toBe(1);
    expect(v.counts.urgentOpen).toBe(1);
    // Live offers only (2 interested + 1 confirmed); the declined row is excluded.
    expect(v.interest.total).toBe(3);
    expect(v.interest.confirmed).toBe(1);

    expect(v.openRequests).toHaveLength(1);
    const open = v.openRequests[0];
    expect(open.id).toBe("r1");
    expect(open.interested).toBe(2); // declined/confirmed elsewhere don't count toward an open request's interest
    expect(open.hostName).toBe("Hana Host");
  });
});
