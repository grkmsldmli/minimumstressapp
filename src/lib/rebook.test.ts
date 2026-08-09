import { describe, expect, it } from "vitest";

import type { Booking } from "./domain";
import { nextOccurrence, rebookable } from "./rebook";

/** A Monday at 10:00. */
const NOW = new Date(2026, 7, 3, 10, 0, 0);
const HORIZON = 7;

const booking = (over: Partial<Booking> = {}): Booking =>
  ({
    id: "b1",
    spaceId: "willow",
    spaceName: "Willow Room",
    startsAt: new Date(2026, 6, 28, 14, 0, 0), // a Tuesday at 14:00
    status: "completed",
    ...over,
  }) as Booking;

describe("nextOccurrence", () => {
  it("finds the same weekday and hour next time it comes round", () => {
    const tuesday2pm = new Date(2026, 6, 28, 14, 0, 0);
    const next = nextOccurrence(tuesday2pm, NOW, HORIZON)!;

    expect(next.getDay()).toBe(2);
    expect(next.getHours()).toBe(14);
    expect(next > NOW).toBe(true);
  });

  it("offers later today when the hour has not passed", () => {
    const mondayEvening = new Date(2026, 6, 27, 18, 0, 0);
    const next = nextOccurrence(mondayEvening, NOW, HORIZON)!;

    expect(next.getDate()).toBe(3);
    expect(next.getHours()).toBe(18);
  });

  /** A 9am slot suggested at 10am is not a suggestion. */
  it("skips to next week when today's hour is already gone", () => {
    const mondayMorning = new Date(2026, 6, 27, 9, 0, 0);
    const next = nextOccurrence(mondayMorning, NOW, HORIZON)!;

    expect(next.getDate()).toBe(10);
    expect(next.getHours()).toBe(9);
  });

  /**
   * A shortcut that leads to a refusal is worse than no shortcut. The window
   * here is the same one the booking rules enforce.
   */
  it("gives up rather than offer a slot outside the booking window", () => {
    const tuesday = new Date(2026, 6, 28, 14, 0, 0);
    expect(nextOccurrence(tuesday, NOW, 0)).toBeNull();
  });
});

describe("rebookable", () => {
  it("offers a room somebody has used", () => {
    const found = rebookable([booking()], NOW, HORIZON);

    expect(found).toHaveLength(1);
    expect(found[0].spaceName).toBe("Willow Room");
    expect(found[0].nextStart.getHours()).toBe(14);
  });

  it("offers each room once, at its most recent hour", () => {
    const found = rebookable(
      [
        booking({ id: "old", startsAt: new Date(2026, 6, 21, 9, 0, 0) }),
        booking({ id: "new", startsAt: new Date(2026, 6, 28, 14, 0, 0) }),
      ],
      NOW,
      HORIZON,
    );

    expect(found).toHaveLength(1);
    expect(found[0].nextStart.getHours()).toBe(14);
  });

  /** A session somebody called off is not one to hand back to them. */
  it.each(["cancelled_by_practitioner", "cancelled_by_host", "no_show"])(
    "leaves out a %s booking",
    (status) => {
      expect(rebookable([booking({ status: status as Booking["status"] })], NOW, HORIZON)).toEqual(
        [],
      );
    },
  );

  /** Evidence of the same habit, just not yet in the past. */
  it("counts a session still ahead", () => {
    const found = rebookable(
      [booking({ status: "upcoming", startsAt: new Date(2026, 7, 5, 11, 0, 0) })],
      NOW,
      HORIZON,
    );

    expect(found).toHaveLength(1);
  });

  it("keeps the most recent rooms and stops", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      booking({
        id: `b${i}`,
        spaceId: `space-${i}`,
        spaceName: `Room ${i}`,
        startsAt: new Date(2026, 6, 28 - i, 14, 0, 0),
      }),
    );

    expect(rebookable(many, NOW, HORIZON, 4)).toHaveLength(4);
  });

  it("has nothing to offer somebody who has never booked", () => {
    expect(rebookable([], NOW, HORIZON)).toEqual([]);
  });
});
