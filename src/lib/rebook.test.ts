import { describe, expect, it } from "vitest";

import type { Booking } from "./domain";
import { nextOccurrence, rebookable } from "./rebook";
import { civilIn, instantFrom, minuteOfDayIn, weekdayOf } from "./timezone";

/*
 * Everything here is on the room's clock. Built with `new Date(y, m, d, h)` it
 * would be on the test runner's, which is how the app came to suggest hours the
 * server then refused.
 */
const ZONE = "America/Los_Angeles";

const at = (month: number, day: number, hour: number): Date => {
  const instant = instantFrom({ year: 2026, month, day }, hour * 60, ZONE);
  if (!instant) throw new Error(`${hour}:00 does not exist on ${month}/${day}`);
  return instant;
};

/** A Monday at 10:00 where the room is. */
const NOW = at(8, 3, 10);
const HORIZON = 7;

const dayOf = (d: Date) => civilIn(d, ZONE).day;
const hourOf = (d: Date) => minuteOfDayIn(d, ZONE) / 60;

const booking = (over: Partial<Booking> = {}): Booking =>
  ({
    id: "b1",
    spaceId: "willow",
    spaceName: "Willow Room",
    startsAt: at(7, 28, 14), // a Tuesday at 14:00
    timeZone: ZONE,
    status: "completed",
    ...over,
  }) as Booking;

describe("nextOccurrence", () => {
  it("finds the same weekday and hour next time it comes round", () => {
    const next = nextOccurrence(at(7, 28, 14), NOW, HORIZON, ZONE);

    expect(next).not.toBeNull();
    if (!next) return;
    expect(weekdayOf(civilIn(next, ZONE))).toBe(2);
    expect(hourOf(next)).toBe(14);
    expect(next > NOW).toBe(true);
  });

  it("offers later today when the hour has not passed", () => {
    const next = nextOccurrence(at(7, 27, 18), NOW, HORIZON, ZONE);

    expect(next).not.toBeNull();
    if (!next) return;
    expect(dayOf(next)).toBe(3);
    expect(hourOf(next)).toBe(18);
  });

  /** A 9am slot suggested at 10am is not a suggestion. */
  it("skips to next week when today's hour is already gone", () => {
    const next = nextOccurrence(at(7, 27, 9), NOW, HORIZON, ZONE);

    expect(next).not.toBeNull();
    if (!next) return;
    expect(dayOf(next)).toBe(10);
    expect(hourOf(next)).toBe(9);
  });

  /**
   * A shortcut that leads to a refusal is worse than no shortcut. The window
   * here is the same one the booking rules enforce.
   */
  it("gives up rather than offer a slot outside the booking window", () => {
    expect(nextOccurrence(at(7, 28, 14), NOW, 0, ZONE)).toBeNull();
  });

  /**
   * The habit is the room's, not the reader's. A practitioner who books a New
   * York studio at 5pm and then opens the app from California must be offered
   * that studio's 5pm — not 5pm Pacific, which is after the room has closed.
   */
  it("keeps the room's hour when the reader is somewhere else", () => {
    const NYC = "America/New_York";
    const fivePmInNewYork = instantFrom({ year: 2026, month: 7, day: 28 }, 17 * 60, NYC);

    expect(fivePmInNewYork).not.toBeNull();
    if (!fivePmInNewYork) return;

    const next = nextOccurrence(fivePmInNewYork, NOW, HORIZON, NYC);

    expect(next).not.toBeNull();
    if (!next) return;
    expect(minuteOfDayIn(next, NYC) / 60).toBe(17);
    // The same moment is 2pm Pacific, which is what reading it in the reader's
    // zone would have produced instead.
    expect(minuteOfDayIn(next, ZONE) / 60).toBe(14);
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
