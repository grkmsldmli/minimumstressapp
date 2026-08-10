import { describe, expect, it } from "vitest";

import {
  type AvailabilityBlock,
  blocksForDay,
  findProblems,
  isValidSchedule,
  normalize,
  slotStartsForDate,
} from "./availability";
import { minuteOfDayIn } from "./timezone";

const at = (weekday: number, startHour: number, endHour: number): AvailabilityBlock => ({
  weekday,
  startMinute: startHour * 60,
  endMinute: endHour * 60,
});

/** The brief's own example: one Monday, three blocks, real gaps between them. */
const MONDAY_SPLIT = [at(1, 7, 8), at(1, 14, 15), at(1, 17, 21)];

describe("multiple blocks per day", () => {
  it("keeps three separate Monday blocks distinct rather than collapsing them", () => {
    const day = blocksForDay(MONDAY_SPLIT, 1);

    expect(day).toHaveLength(3);
    expect(day.map((b) => b.startMinute)).toEqual([420, 840, 1020]);
    expect(isValidSchedule(MONDAY_SPLIT)).toBe(true);
  });

  it("returns them in time order however they were entered", () => {
    const shuffled = [at(1, 17, 21), at(1, 7, 8), at(1, 14, 15)];
    expect(blocksForDay(shuffled, 1).map((b) => b.startMinute)).toEqual([420, 840, 1020]);
  });

  it("keeps weekdays independent", () => {
    const blocks = [...MONDAY_SPLIT, at(3, 9, 17)];
    expect(blocksForDay(blocks, 1)).toHaveLength(3);
    expect(blocksForDay(blocks, 3)).toHaveLength(1);
    expect(blocksForDay(blocks, 5)).toHaveLength(0);
  });
});

describe("validation the prototype was missing", () => {
  it("rejects a block that ends before it starts", () => {
    const problems = findProblems([at(1, 17, 9)]);

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe("inverted");
  });

  it("rejects a zero-length block", () => {
    expect(isValidSchedule([at(2, 10, 10)])).toBe(false);
  });

  it("flags two blocks that overlap on the same day", () => {
    const problems = findProblems([at(1, 9, 12), at(1, 11, 14)]);

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe("overlap");
  });

  it("allows blocks that merely touch, since one ends as the next begins", () => {
    expect(isValidSchedule([at(1, 9, 12), at(1, 12, 15)])).toBe(true);
  });

  it("does not treat the same hours on different days as an overlap", () => {
    expect(isValidSchedule([at(1, 9, 12), at(2, 9, 12)])).toBe(true);
  });
});

describe("normalize", () => {
  it("merges overlapping and touching blocks", () => {
    expect(normalize([at(1, 9, 12), at(1, 11, 14), at(1, 14, 16)])).toEqual([at(1, 9, 16)]);
  });

  it("leaves genuine gaps alone", () => {
    expect(normalize(MONDAY_SPLIT)).toEqual(MONDAY_SPLIT);
  });

  it("drops inverted and empty blocks", () => {
    expect(normalize([at(1, 17, 9), at(1, 10, 10), at(1, 9, 12)])).toEqual([at(1, 9, 12)]);
  });
});

describe("slot generation", () => {
  // 2026-08-03 is a Monday.
  const monday = { year: 2026, month: 8, day: 3 };
  const LA = "America/Los_Angeles";

  /** The hour a slot starts, read on the room's clock rather than the runner's. */
  const hours = (starts: Date[], zone = LA) => starts.map((d) => minuteOfDayIn(d, zone) / 60);

  it("offers one slot per whole hour inside a block", () => {
    expect(hours(slotStartsForDate([at(1, 17, 21)], monday, LA))).toEqual([17, 18, 19, 20]);
  });

  it("offers exactly one slot for a one-hour block", () => {
    expect(slotStartsForDate([at(1, 7, 8)], monday, LA)).toHaveLength(1);
  });

  it("draws from every block on the day, in order", () => {
    expect(hours(slotStartsForDate(MONDAY_SPLIT, monday, LA))).toEqual([7, 14, 17, 18, 19, 20]);
  });

  it("offers nothing on a day the host has not opened", () => {
    const tuesday = { year: 2026, month: 8, day: 4 };
    expect(slotStartsForDate(MONDAY_SPLIT, tuesday, LA)).toHaveLength(0);
  });

  it("reserves the turnover buffer so a session never overruns its block", () => {
    // A 30-minute turnover needs 90 minutes per booking, so 17-21 fits three.
    expect(hours(slotStartsForDate([at(1, 17, 21)], monday, LA, 30))).toEqual([17, 18, 19]);
  });

  it("offers nothing when the buffer does not fit the block at all", () => {
    expect(slotStartsForDate([at(1, 7, 8)], monday, LA, 30)).toHaveLength(0);
  });

  /**
   * The bug this whole model exists for.
   *
   * Both sides used to build the grid from their own timezone, so the phone
   * offered 4pm Pacific and the server checked a grid made of UTC hours. The
   * instants have to be a fact about the room, not about who is asking.
   *
   * Written as an absolute instant rather than a comparison, so a wrong answer
   * shows up as a wrong number instead of two matching mistakes.
   */
  it("names an instant the room agrees with, not the reader", () => {
    const starts = slotStartsForDate([at(1, 9, 17)], monday, LA);

    // 9am Pacific in August is 16:00 UTC.
    expect(starts[0].toISOString()).toBe("2026-08-03T16:00:00.000Z");
    expect(starts.at(-1)?.toISOString()).toBe("2026-08-03T23:00:00.000Z");
  });

  it("puts a room in New York three hours before one in California", () => {
    const east = slotStartsForDate([at(1, 9, 10)], monday, "America/New_York");
    const west = slotStartsForDate([at(1, 9, 10)], monday, LA);

    expect(west[0].getTime() - east[0].getTime()).toBe(3 * 60 * 60 * 1000);
  });

  /**
   * On 8 March 2026 the Pacific clock goes 1:59am straight to 3:00am. A block
   * covering 2am has no instant to point at, and offering a booking for a
   * moment that never arrives is worse than offering one fewer hour.
   */
  it("drops an hour that daylight saving skips", () => {
    const springForward = { year: 2026, month: 3, day: 8 };
    const starts = slotStartsForDate(
      [{ weekday: 0, startMinute: 60, endMinute: 300 }],
      springForward,
      LA,
    );

    expect(hours(starts)).toEqual([1, 3, 4]);
  });
});
