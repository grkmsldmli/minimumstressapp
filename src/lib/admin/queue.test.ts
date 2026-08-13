import { describe, expect, it } from "vitest";

import {
  LIVE_LEAD_MS,
  LIVE_TRAIL_MS,
  type PaidBooking,
  buildActivity,
  rollUp,
  sessionState,
} from "./queue";

/**
 * The operator screen turns numbers back into names, and this is the part that
 * decides whose name. Money on the wrong row is worse than no number at all:
 * it is wrong with the same confidence as it would be right, and somebody
 * would act on it before doubting it.
 */

const HOSTS = new Map([
  ["room-1", "host-a"],
  ["room-2", "host-a"],
  ["room-3", "host-b"],
]);

const booking = (over: Partial<PaidBooking> = {}): PaidBooking => ({
  spaceId: "room-1",
  practitionerId: "practitioner-1",
  hostRateCents: 4500,
  totalCents: 5400,
  ...over,
});

describe("rollUp", () => {
  it("pays the host their rate and charges the practitioner the total", () => {
    const { perPerson } = rollUp([booking()], HOSTS);

    expect(perPerson.get("host-a")).toEqual({ sessions: 1, earned: 4500, spent: 0 });
    expect(perPerson.get("practitioner-1")).toEqual({ sessions: 1, earned: 0, spent: 5400 });
  });

  /**
   * The gap between the two is the platform's fee. Summing the columns would
   * count one session's revenue twice, which is the mistake this separation
   * exists to make impossible.
   */
  it("never gives the host the practitioner's fees", () => {
    const { perPerson } = rollUp([booking({ hostRateCents: 4500, totalCents: 5400 })], HOSTS);

    expect(perPerson.get("host-a")!.earned).toBe(4500);
    expect(perPerson.get("host-a")!.spent).toBe(0);
  });

  it("adds up rooms belonging to the same host", () => {
    const { perPerson, perListing } = rollUp(
      [
        booking({ spaceId: "room-1", hostRateCents: 4500 }),
        booking({ spaceId: "room-2", hostRateCents: 6000 }),
      ],
      HOSTS,
    );

    expect(perPerson.get("host-a")).toEqual({ sessions: 2, earned: 10500, spent: 0 });
    expect(perListing.get("room-1")!.earned).toBe(4500);
    expect(perListing.get("room-2")!.earned).toBe(6000);
  });

  it("keeps two hosts apart", () => {
    const { perPerson } = rollUp(
      [booking({ spaceId: "room-1" }), booking({ spaceId: "room-3" })],
      HOSTS,
    );

    expect(perPerson.get("host-a")!.sessions).toBe(1);
    expect(perPerson.get("host-b")!.sessions).toBe(1);
  });

  /** One session, however many roles one person played in it. */
  it("counts a host booking their own room once", () => {
    const { perPerson } = rollUp([booking({ practitionerId: "host-a" })], HOSTS);

    expect(perPerson.get("host-a")!.sessions).toBe(1);
    expect(perPerson.get("host-a")!.earned).toBe(4500);
    expect(perPerson.get("host-a")!.spent).toBe(5400);
  });

  it("still counts the room when the host has since been removed", () => {
    const { perPerson, perListing } = rollUp([booking({ spaceId: "room-gone" })], HOSTS);

    expect(perListing.get("room-gone")!.sessions).toBe(1);
    expect(perPerson.has("host-a")).toBe(false);
    // The practitioner paid regardless of what happened to the other side.
    expect(perPerson.get("practitioner-1")!.spent).toBe(5400);
  });

  it("survives a booking with no practitioner on it", () => {
    const { perPerson } = rollUp([booking({ practitionerId: null })], HOSTS);

    expect(perPerson.get("host-a")!.sessions).toBe(1);
    expect(perPerson.size).toBe(1);
  });

  it("has nothing to say about a marketplace with no paid bookings", () => {
    const { perPerson, perListing } = rollUp([], HOSTS);

    expect(perPerson.size).toBe(0);
    expect(perListing.size).toBe(0);
  });

  /**
   * Whatever else moves, the platform's cut is what is left over. If the two
   * columns ever drift, this is the assertion that fails first.
   */
  it("leaves the platform exactly the difference across many bookings", () => {
    const bookings = Array.from({ length: 25 }, (_, index) =>
      booking({
        spaceId: index % 2 === 0 ? "room-1" : "room-3",
        practitionerId: `practitioner-${index % 4}`,
        hostRateCents: 3000 + index * 100,
        totalCents: Math.round((3000 + index * 100) * 1.2),
      }),
    );

    const { perPerson } = rollUp(bookings, HOSTS);

    const earned = [...perPerson.values()].reduce((sum, t) => sum + t.earned, 0);
    const spent = [...perPerson.values()].reduce((sum, t) => sum + t.spent, 0);
    const expected = bookings.reduce((sum, b) => sum + (b.totalCents - b.hostRateCents), 0);

    expect(spent - earned).toBe(expected);
  });
});

describe("sessionState", () => {
  const NOW = new Date("2026-08-11T18:00:00Z");
  const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

  /** Session 17:00-18:00, so `now` is the moment it ends. */
  const at = (startHoursFromNow: number, status = "upcoming") =>
    sessionState(status, hours(startHoursFromNow), hours(startHoursFromNow + 1), NOW);

  it("names which side of the hour a session is on", () => {
    expect(at(-0.5)).toBe("in progress");
    expect(at(1)).toBe("starting soon");
    expect(at(-2)).toBe("just finished");
  });

  it("reaches two hours ahead and no further", () => {
    expect(at(LIVE_LEAD_MS / 3_600_000)).toBe("starting soon");
    expect(at(LIVE_LEAD_MS / 3_600_000 + 0.01)).toBeNull();
  });

  it("keeps a finished session reachable for two hours", () => {
    // Ends three hours ago: exactly the trailing edge, since the session runs
    // an hour and the window is measured from its end.
    expect(at(-1 - LIVE_TRAIL_MS / 3_600_000)).toBe("just finished");
    expect(at(-1.01 - LIVE_TRAIL_MS / 3_600_000)).toBeNull();
  });

  /**
   * Nobody is in that room. Listing it would send somebody looking for a person
   * who never came, which is worse than an empty panel.
   */
  it("leaves out sessions nobody is attending", () => {
    expect(at(-0.5, "cancelled_by_practitioner")).toBeNull();
    expect(at(-0.5, "cancelled_by_host")).toBeNull();
    expect(at(-0.5, "no_show")).toBeNull();
  });

  it("keeps a completed session, which is how a past hour is recorded", () => {
    expect(at(-1.5, "completed")).toBe("just finished");
  });
});

/**
 * The feed a person reads to decide whether the marketplace is working.
 *
 * It had no test at all, and it was counting held hours as bookings. An
 * abandoned checkout sits at `upcoming` with no `captured_at` until the sweep
 * reaches it, and it appeared here as "— booked" — the exact failure
 * abandoned.ts predicted when it named who pays for the leftovers: "The
 * operator's numbers lie. Booked this month counts money that was never
 * taken."
 */
describe("the activity feed", () => {
  const spaceName = new Map([["space-1", "Reformer Hit"]]);

  const feed = (rows: Record<string, unknown>[]) =>
    buildActivity({
      rows,
      spaceName,
      spaces: [],
      profiles: [],
      reviews: [],
      messages: [],
      emails: new Map(),
    });

  const booking = (over: Record<string, unknown> = {}) => ({
    id: "b1",
    space_id: "space-1",
    status: "upcoming",
    starts_at: "2026-09-01T17:00:00Z",
    captured_at: "2026-08-20T10:00:00Z",
    ...over,
  });

  it("reports a paid booking", () => {
    expect(feed([booking()]).map((e) => e.text)).toEqual(["Reformer Hit — booked"]);
  });

  it("says nothing about an hour somebody held and never paid for", () => {
    expect(feed([booking({ captured_at: null })])).toEqual([]);
  });

  /**
   * A cancelled row is a thing that happened to somebody, and this feed is a
   * history rather than a ledger — so it stays whatever its money did.
   */
  it("keeps a cancellation whether or not it was ever paid", () => {
    const texts = feed([
      booking({ id: "b1", status: "cancelled_by_practitioner", cancelled_at: "2026-08-21T10:00:00Z" }),
      booking({ id: "b2", status: "cancelled_by_host", captured_at: null, cancelled_at: "2026-08-22T10:00:00Z" }),
    ]).map((e) => e.text);

    expect(texts).toContain("Reformer Hit — cancelled by the practitioner");
    expect(texts).toContain("Reformer Hit — cancelled by the studio");
  });

  it("does not drop a completed session", () => {
    expect(feed([booking({ status: "completed" })])).toHaveLength(1);
  });
});
