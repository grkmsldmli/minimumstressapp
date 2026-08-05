import { describe, expect, it } from "vitest";

import { type PaidBooking, rollUp } from "./queue";

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
