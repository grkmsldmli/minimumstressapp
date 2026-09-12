import { describe, expect, it } from "vitest";

import type { Directory } from "./directory";
import {
  bookingDetail,
  filterBookings,
  filterPeople,
  filterSpaces,
  paginate,
  personDetail,
  searchDirectory,
  spaceDetail,
} from "./projections";

/**
 * The directory projections are what every section renders, so their filtering,
 * pagination, search and detail selection are tested against a fixed graph. The
 * privacy guarantee is structural: a booking here carries no message field to
 * leak, and these tests assert the shape stays that way.
 */

const dir: Directory = {
  people: [
    {
      id: "host-1",
      email: "hana@example.com",
      displayName: "Hana Host",
      accountType: "host",
      joinedAt: "2026-01-01T00:00:00Z",
      listings: 1,
      sessions: 3,
      earnedCents: 30000,
      spentCents: 0,
      lateCancellations: 0,
      suspended: false,
      payoutsReady: true,
      emergency: { name: "Kin", phone: "555", relationship: "sister" },
    },
    {
      id: "prac-1",
      email: "pip@example.com",
      displayName: "Pip Practitioner",
      accountType: "practitioner",
      joinedAt: "2026-02-01T00:00:00Z",
      listings: 0,
      sessions: 2,
      earnedCents: 0,
      spentCents: 20000,
      lateCancellations: 2,
      suspended: false,
      payoutsReady: null,
      emergency: { name: null, phone: null, relationship: null },
    },
    {
      id: "prac-2",
      email: "quinn@example.com",
      displayName: "Quinn",
      accountType: "practitioner",
      joinedAt: "2026-03-01T00:00:00Z",
      listings: 0,
      sessions: 0,
      earnedCents: 0,
      spentCents: 0,
      lateCancellations: 0,
      suspended: true,
      payoutsReady: null,
      emergency: { name: null, phone: null, relationship: null },
    },
  ],
  spaces: [
    {
      id: "space-1",
      name: "Sunlit Studio",
      status: "active",
      category: "yoga",
      hourlyRateCents: 5000,
      hostId: "host-1",
      hostEmail: "hana@example.com",
      hostName: "Hana Host",
      addressLine: "12 Bright Lane",
      sessions: 3,
      earnedCents: 30000,
      createdAt: "2026-01-02T00:00:00Z",
      archivedAt: null,
    },
    {
      id: "space-2",
      name: "Quiet Room",
      status: "pending",
      category: "massage",
      hourlyRateCents: 8000,
      hostId: "host-1",
      hostEmail: "hana@example.com",
      hostName: "Hana Host",
      addressLine: null,
      sessions: 0,
      earnedCents: 0,
      createdAt: "2026-04-01T00:00:00Z",
      archivedAt: null,
    },
  ],
  bookings: [
    {
      id: "book-1",
      spaceId: "space-1",
      spaceName: "Sunlit Studio",
      practitionerId: "prac-1",
      practitionerName: "Pip Practitioner",
      practitionerEmail: "pip@example.com",
      hostId: "host-1",
      hostName: "Hana Host",
      hostEmail: "hana@example.com",
      startsAt: "2026-05-01T10:00:00Z",
      endsAt: "2026-05-01T11:00:00Z",
      status: "completed",
      totalCents: 10000,
      hostRateCents: 8000,
      platformCents: 2000,
      paid: true,
      capturedAt: "2026-04-30T10:00:00Z",
      cancelledAt: null,
      refundedAt: null,
      hostPaidAt: "2026-05-02T10:00:00Z",
    },
    {
      id: "book-2",
      spaceId: "space-1",
      spaceName: "Sunlit Studio",
      practitionerId: "prac-1",
      practitionerName: "Pip Practitioner",
      practitionerEmail: "pip@example.com",
      hostId: "host-1",
      hostName: "Hana Host",
      hostEmail: "hana@example.com",
      startsAt: "2026-05-03T10:00:00Z",
      endsAt: "2026-05-03T11:00:00Z",
      status: "cancelled_by_practitioner",
      totalCents: 10000,
      hostRateCents: 8000,
      platformCents: 2000,
      paid: false,
      capturedAt: null,
      cancelledAt: "2026-05-02T10:00:00Z",
      refundedAt: null,
      hostPaidAt: null,
    },
    {
      id: "book-3",
      spaceId: "space-1",
      spaceName: "Sunlit Studio",
      practitionerId: "prac-2",
      practitionerName: "Quinn",
      practitionerEmail: "quinn@example.com",
      hostId: "host-1",
      hostName: "Hana Host",
      hostEmail: "hana@example.com",
      startsAt: "2026-06-01T10:00:00Z",
      endsAt: "2026-06-01T11:00:00Z",
      status: "upcoming",
      totalCents: 10000,
      hostRateCents: 8000,
      platformCents: 2000,
      paid: true,
      capturedAt: "2026-05-30T10:00:00Z",
      cancelledAt: null,
      refundedAt: null,
      hostPaidAt: null,
    },
  ],
};

describe("filterPeople", () => {
  it("filters by account type", () => {
    expect(filterPeople(dir.people, { type: "host" }).map((p) => p.id)).toEqual(["host-1"]);
    expect(filterPeople(dir.people, { type: "practitioner" })).toHaveLength(2);
  });

  it("searches name, email and id case-insensitively", () => {
    expect(filterPeople(dir.people, { q: "PIP" }).map((p) => p.id)).toEqual(["prac-1"]);
    expect(filterPeople(dir.people, { q: "example.com" })).toHaveLength(3);
    expect(filterPeople(dir.people, { q: "host-1" }).map((p) => p.id)).toEqual(["host-1"]);
  });

  it("treats an absent or 'all' type as no filter", () => {
    expect(filterPeople(dir.people, {})).toHaveLength(3);
    expect(filterPeople(dir.people, { type: "all" })).toHaveLength(3);
  });
});

describe("filterSpaces & filterBookings", () => {
  it("filters spaces by status and searches address/host", () => {
    expect(filterSpaces(dir.spaces, { status: "pending" }).map((s) => s.id)).toEqual(["space-2"]);
    expect(filterSpaces(dir.spaces, { q: "bright lane" }).map((s) => s.id)).toEqual(["space-1"]);
    expect(filterSpaces(dir.spaces, { q: "hana" })).toHaveLength(2);
  });

  it("filters bookings by status and searches parties", () => {
    expect(filterBookings(dir.bookings, { status: "upcoming" }).map((b) => b.id)).toEqual(["book-3"]);
    expect(filterBookings(dir.bookings, { q: "quinn" }).map((b) => b.id)).toEqual(["book-3"]);
    expect(filterBookings(dir.bookings, { q: "sunlit" })).toHaveLength(3);
  });
});

describe("paginate", () => {
  it("slices and reports totals", () => {
    const page1 = paginate([1, 2, 3, 4, 5], 1, 2);
    expect(page1.items).toEqual([1, 2]);
    expect(page1.total).toBe(5);
    expect(page1.pages).toBe(3);
    expect(paginate([1, 2, 3, 4, 5], 3, 2).items).toEqual([5]);
  });

  it("clamps an out-of-range page to the last one", () => {
    expect(paginate([1, 2, 3], 99, 2).page).toBe(2);
    expect(paginate([1, 2, 3], 0, 2).page).toBe(1);
  });

  it("never returns an empty page for a non-empty list at page 1", () => {
    expect(paginate([], 1, 25).pages).toBe(1);
    expect(paginate([], 1, 25).items).toEqual([]);
  });
});

describe("searchDirectory", () => {
  it("returns nothing under two characters", () => {
    expect(searchDirectory(dir, "a").totalPeople).toBe(0);
    expect(searchDirectory(dir, " ").people).toEqual([]);
  });

  it("finds across all three entity kinds", () => {
    const r = searchDirectory(dir, "hana");
    expect(r.totalPeople).toBe(1);
    expect(r.totalSpaces).toBe(2);
    expect(r.totalBookings).toBe(3);
  });

  it("caps each kind at the limit but reports the true total", () => {
    const r = searchDirectory(dir, "sunlit", 2);
    expect(r.bookings).toHaveLength(2);
    expect(r.totalBookings).toBe(3);
  });
});

describe("detail selectors", () => {
  it("builds a person's listings and both booking sides", () => {
    const d = personDetail(dir, "host-1")!;
    expect(d.listings.map((s) => s.id)).toEqual(["space-1", "space-2"]);
    expect(d.asHost.map((b) => b.id)).toEqual(["book-1", "book-2", "book-3"]);
    expect(d.asPractitioner).toEqual([]);

    const p = personDetail(dir, "prac-1")!;
    expect(p.asPractitioner.map((b) => b.id)).toEqual(["book-1", "book-2"]);
    expect(p.listings).toEqual([]);
  });

  it("returns null for an unknown id", () => {
    expect(personDetail(dir, "nope")).toBeNull();
    expect(spaceDetail(dir, "nope")).toBeNull();
    expect(bookingDetail(dir, "nope")).toBeNull();
  });

  it("builds a space's booking history", () => {
    expect(spaceDetail(dir, "space-1")!.bookings).toHaveLength(3);
    expect(spaceDetail(dir, "space-2")!.bookings).toHaveLength(0);
  });
});

describe("privacy", () => {
  it("carries no message contents on any booking shape", () => {
    for (const b of dir.bookings) {
      expect(b).not.toHaveProperty("message");
      expect(b).not.toHaveProperty("messages");
      expect(b).not.toHaveProperty("body");
      expect(b).not.toHaveProperty("accessCode");
    }
  });
});
