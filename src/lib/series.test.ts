import { describe, expect, it } from "vitest";

import { BOOKING_HORIZON_DAYS, PRO_BOOKING_HORIZON_DAYS } from "./money";
import {
  MAX_SERIES_OCCURRENCES,
  describeSeries,
  seriesNeedsPro,
  seriesOccurrences,
  weeksAvailable,
} from "./series";
import { instantFrom, minuteOfDayIn, civilIn, weekdayOf } from "./timezone";

const LA = "America/Los_Angeles";

/** A Tuesday at 17:00 in the room's own city. */
const at = (month: number, day: number, hour = 17): Date => {
  const instant = instantFrom({ year: 2026, month, day }, hour * 60, LA);
  if (!instant) throw new Error(`${hour}:00 does not exist on ${month}/${day}`);
  return instant;
};

const NOW = at(8, 10, 9);

const run = (over: Partial<Parameters<typeof seriesOccurrences>[0]> = {}) =>
  seriesOccurrences({
    firstStart: at(8, 11),
    weeks: 4,
    timeZone: LA,
    isPro: true,
    now: NOW,
    ...over,
  });

describe("picking the dates", () => {
  it("keeps the same weekday and the same hour every week", () => {
    const starts = run();

    expect(starts).toHaveLength(4);
    for (const start of starts) {
      expect(weekdayOf(civilIn(start, LA))).toBe(2);
      expect(minuteOfDayIn(start, LA)).toBe(17 * 60);
    }
  });

  it("steps seven days at a time", () => {
    const starts = run();
    expect(starts.map((d) => civilIn(d, LA).day)).toEqual([11, 18, 25, 1]);
  });

  /**
   * The reason dates are stepped on a calendar rather than by adding 168
   * hours. Across a daylight-saving change the arithmetic version moves a five
   * o'clock class to four, and nobody notices until somebody is early.
   */
  it("holds the hour across a daylight-saving change", () => {
    const beforeTheChange = at(10, 27); // Tuesday, PDT
    const starts = seriesOccurrences({
      firstStart: beforeTheChange,
      weeks: 3,
      timeZone: LA,
      isPro: true,
      now: at(10, 20, 9),
    });

    // 1 November is when the Pacific clock goes back, so week three is PST.
    expect(starts).toHaveLength(3);
    for (const start of starts) {
      expect(minuteOfDayIn(start, LA)).toBe(17 * 60);
    }
    /*
     * The week that spans the change is 169 hours long in real time, not 168.
     * That is the whole point: the wall clock stayed at five, so the instant
     * had to move. The weeks either side of it are ordinary.
     */
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    expect(starts[1].getTime() - starts[0].getTime()).toBe(WEEK + 60 * 60 * 1000);
    expect(starts[2].getTime() - starts[1].getTime()).toBe(WEEK);
  });
});

describe("what the horizon allows", () => {
  it("stops a Pro series at thirty days", () => {
    const starts = run({ weeks: MAX_SERIES_OCCURRENCES });

    const last = starts.at(-1);
    expect(last).toBeDefined();
    if (!last) return;

    const daysOut = (last.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeLessThanOrEqual(PRO_BOOKING_HORIZON_DAYS);
  });

  it("stops a free account much sooner", () => {
    const pro = run({ weeks: MAX_SERIES_OCCURRENCES, isPro: true }).length;
    const free = run({ weeks: MAX_SERIES_OCCURRENCES, isPro: false }).length;

    expect(free).toBeLessThan(pro);
    expect(free * 7).toBeLessThanOrEqual(BOOKING_HORIZON_DAYS + 7);
  });

  /** A crafted payload must not make us reject a thousand dates one at a time. */
  it("never returns more than the cap however many are asked for", () => {
    expect(run({ weeks: 9999 }).length).toBeLessThanOrEqual(MAX_SERIES_OCCURRENCES);
  });

  it("treats nonsense counts as one session", () => {
    expect(run({ weeks: 0 })).toHaveLength(1);
    expect(run({ weeks: -3 })).toHaveLength(1);
  });

  it("reports how many weeks are actually available", () => {
    expect(weeksAvailable(at(8, 11), LA, true, NOW)).toBe(run({ weeks: MAX_SERIES_OCCURRENCES }).length);
  });
});

describe("telling somebody what happened", () => {
  const start = at(8, 11);

  it("says it plainly when every week worked", () => {
    expect(
      describeSeries({
        booked: [
          { startsAt: start, bookingId: "a" },
          { startsAt: start, bookingId: "b" },
        ],
        skipped: [],
      }),
    ).toMatch(/All 2 weeks/);
  });

  /**
   * The normal case, and the one worth wording carefully. Somebody booking four
   * Tuesdays will find one already taken; three bookings and a sentence is the
   * honest answer, not a refusal of the lot and not a silent three.
   */
  it("names the shortfall rather than only the total", () => {
    const said = describeSeries({
      booked: [{ startsAt: start, bookingId: "a" }],
      skipped: [{ startsAt: start, because: "Somebody else has that hour" }],
    });

    expect(said).toMatch(/1 of 2/);
    expect(said).toMatch(/listed below/);
  });

  it("does not pretend when nothing worked", () => {
    expect(describeSeries({ booked: [], skipped: [{ startsAt: start, because: "x" }] })).toMatch(
      /None/,
    );
  });
});

describe("who may book a term", () => {
  it("lets anybody book one session", () => {
    expect(seriesNeedsPro(1)).toBe(false);
  });

  it("asks for Pro past that", () => {
    expect(seriesNeedsPro(2)).toBe(true);
  });
});
