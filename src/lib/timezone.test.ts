import { describe, expect, it } from "vitest";

import {
  addDays,
  civilIn,
  compareCivil,
  instantFrom,
  isKnownZone,
  minuteOfDayIn,
  offsetMsAt,
  sameCivil,
  weekdayOf,
  zonesDiffer,
} from "./timezone";

const LA = "America/Los_Angeles";
const NY = "America/New_York";
const HOUR = 60 * 60 * 1000;

describe("wall clock to instant", () => {
  /**
   * The assertion the whole booking flow rests on.
   *
   * A host opens at 9am. That has to mean one moment in time, and the same
   * moment whether the question is asked from a phone in California, a server
   * in Virginia, or a test runner on a laptop set to Istanbul.
   */
  it("turns a wall-clock time into one absolute instant", () => {
    const instant = instantFrom({ year: 2026, month: 8, day: 3 }, 9 * 60, LA);
    expect(instant?.toISOString()).toBe("2026-08-03T16:00:00.000Z");
  });

  it("follows the zone into and out of daylight saving", () => {
    // Same wall clock, five months apart: PDT in August, PST in January.
    const summer = instantFrom({ year: 2026, month: 8, day: 3 }, 9 * 60, LA);
    const winter = instantFrom({ year: 2026, month: 1, day: 5 }, 9 * 60, LA);

    expect(summer?.toISOString()).toBe("2026-08-03T16:00:00.000Z");
    expect(winter?.toISOString()).toBe("2026-01-05T17:00:00.000Z");
  });

  /**
   * 8 March 2026, 2am Pacific: the clock goes 1:59 to 3:00 and that hour is
   * never lived through. Returning *something* would book a moment that does
   * not arrive, so nothing is returned and the caller drops the slot.
   */
  it("refuses an hour daylight saving skips", () => {
    const gap = { year: 2026, month: 3, day: 8 };
    expect(instantFrom(gap, 2 * 60, LA)).toBeNull();
    expect(instantFrom(gap, 2 * 60 + 30, LA)).toBeNull();
    expect(instantFrom(gap, 3 * 60, LA)).not.toBeNull();
  });

  /**
   * 1 November 2026: 1am Pacific happens twice. The first is the one somebody
   * means when they say "we open at one", and picking either consistently
   * matters more than which — a slot that moved between two renders would let
   * the client and the server disagree again.
   */
  it("picks the first of a repeated hour, every time", () => {
    const fallBack = { year: 2026, month: 11, day: 1 };
    const first = instantFrom(fallBack, 60, LA);

    expect(first?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(instantFrom(fallBack, 60, LA)?.getTime()).toBe(first?.getTime());
  });

  it("round-trips: an instant read back gives the clock it was built from", () => {
    for (const minute of [0, 9 * 60, 13 * 60 + 30, 23 * 60 + 59]) {
      const day = { year: 2026, month: 6, day: 15 };
      const instant = instantFrom(day, minute, LA);

      expect(instant).not.toBeNull();
      if (!instant) continue;
      expect(minuteOfDayIn(instant, LA)).toBe(minute);
      expect(civilIn(instant, LA)).toEqual(day);
    }
  });
});

describe("reading an instant in a zone", () => {
  /**
   * The failure that broke booking, stated directly: one moment, two zones, two
   * different calendar days. Anything that asks "what day is this" without
   * naming a zone is picking one by accident.
   */
  it("puts one instant on different days in different zones", () => {
    const lateEvening = new Date("2026-08-04T04:30:00.000Z");

    expect(civilIn(lateEvening, LA)).toEqual({ year: 2026, month: 8, day: 3 });
    expect(civilIn(lateEvening, NY)).toEqual({ year: 2026, month: 8, day: 4 });
  });

  it("measures the offset a zone is running at", () => {
    const august = new Date("2026-08-03T12:00:00Z").getTime();
    const january = new Date("2026-01-05T12:00:00Z").getTime();

    expect(offsetMsAt(august, LA)).toBe(-7 * HOUR);
    expect(offsetMsAt(january, LA)).toBe(-8 * HOUR);
    expect(offsetMsAt(august, "UTC")).toBe(0);
  });
});

describe("calendar arithmetic", () => {
  it("knows the weekday without being told a zone", () => {
    // 3 August 2026 is a Monday, on every wall calendar on earth.
    expect(weekdayOf({ year: 2026, month: 8, day: 3 })).toBe(1);
    expect(weekdayOf({ year: 2026, month: 8, day: 9 })).toBe(0);
  });

  it("rolls over months and years", () => {
    expect(addDays({ year: 2026, month: 8, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 9,
      day: 1,
    });
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });

  it("counts February correctly in a leap year", () => {
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  /**
   * Crossing a daylight-saving boundary must not shift the date. Adding 24
   * hours to a Date does exactly that once a year, which is why days are added
   * on the calendar rather than in milliseconds.
   */
  it("adds a day across a daylight-saving change", () => {
    expect(addDays({ year: 2026, month: 3, day: 7 }, 1)).toEqual({
      year: 2026,
      month: 3,
      day: 8,
    });
  });

  it("orders dates", () => {
    const earlier = { year: 2026, month: 8, day: 3 };
    const later = { year: 2026, month: 9, day: 1 };

    expect(compareCivil(earlier, later)).toBeLessThan(0);
    expect(compareCivil(later, earlier)).toBeGreaterThan(0);
    expect(sameCivil(earlier, { ...earlier })).toBe(true);
  });
});

describe("guards", () => {
  it("recognises a zone this runtime can resolve", () => {
    expect(isKnownZone(LA)).toBe(true);
    expect(isKnownZone("Etc/GMT+8")).toBe(true);
    expect(isKnownZone("")).toBe(false);
    expect(isKnownZone("Nowhere/Nothing")).toBe(false);
  });

  /**
   * The trap worth naming. `Intl` accepts "EST" without complaint and resolves
   * it to America/Panama, which never moves for daylight saving — so a studio
   * in New York saved under that name would run an hour late from March to
   * November, and every slot it offered would be refused.
   */
  it("rejects bare abbreviations, however happily Intl accepts them", () => {
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "EST" }).resolvedOptions().timeZone)
      .toBe("America/Panama");

    expect(isKnownZone("EST")).toBe(false);
    expect(isKnownZone("PST")).toBe(false);
    expect(isKnownZone("UTC")).toBe(false);
  });

  /** Two spellings of one clock are not a difference worth telling anyone about. */
  it("treats aliases of the same clock as the same zone", () => {
    const noon = new Date("2026-08-03T19:00:00Z");

    expect(zonesDiffer(LA, "US/Pacific", noon)).toBe(false);
    expect(zonesDiffer(LA, NY, noon)).toBe(true);
    expect(zonesDiffer(LA, LA, noon)).toBe(false);
  });
});
