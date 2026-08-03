import { describe, expect, it } from "vitest";

import {
  type AvailabilityBlock,
  blocksForDay,
  findProblems,
  isValidSchedule,
  normalize,
  slotStartsForDate,
} from "./availability";

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
  const monday = new Date(2026, 7, 3);

  it("offers one slot per whole hour inside a block", () => {
    const starts = slotStartsForDate([at(1, 17, 21)], monday);
    expect(starts.map((d) => d.getHours())).toEqual([17, 18, 19, 20]);
  });

  it("offers exactly one slot for a one-hour block", () => {
    expect(slotStartsForDate([at(1, 7, 8)], monday)).toHaveLength(1);
  });

  it("draws from every block on the day, in order", () => {
    const starts = slotStartsForDate(MONDAY_SPLIT, monday);
    expect(starts.map((d) => d.getHours())).toEqual([7, 14, 17, 18, 19, 20]);
  });

  it("offers nothing on a day the host has not opened", () => {
    const tuesday = new Date(2026, 7, 4);
    expect(slotStartsForDate(MONDAY_SPLIT, tuesday)).toHaveLength(0);
  });

  it("reserves the turnover buffer so a session never overruns its block", () => {
    // A 30-minute turnover needs 90 minutes per booking, so 17-21 fits three.
    const starts = slotStartsForDate([at(1, 17, 21)], monday, 30);
    expect(starts.map((d) => d.getHours())).toEqual([17, 18, 19]);
  });

  it("offers nothing when the buffer does not fit the block at all", () => {
    expect(slotStartsForDate([at(1, 7, 8)], monday, 30)).toHaveLength(0);
  });
});
