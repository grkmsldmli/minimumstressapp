import { describe, expect, it } from "vitest";

import {
  sessionDate,
  sessionDayLong,
  sessionDayShort,
  sessionHour,
  sessionTime,
  sessionWeekday,
  sessionWhen,
  sessionZoneLabel,
} from "./when";
import { viewerZone } from "./timezone";

/**
 * How a session's hour is written on a screen.
 *
 * Every one of these reads the room's zone rather than the server's, which is
 * the bug the whole module exists to prevent: a Tuesday evening in California
 * arrives at a UTC server as Wednesday, and a room's own calendar is the only
 * one that can say which day it opened.
 *
 * The zone label is the subtle part. It is appended only when the *reader* is
 * somewhere else — right for a screen, wrong for a message forwarded to
 * somebody whose phone we know nothing about, which is why share-session.ts
 * names the zone unconditionally instead of using these.
 */

/** 9pm on a Wednesday in San Mateo. Thursday 04:00 in UTC. */
const NINE_PM_PACIFIC = new Date("2026-08-27T04:00:00Z");
const PACIFIC = "America/Los_Angeles";

describe("the room's own clock", () => {
  it("reports the room's weekday, not the server's", () => {
    // UTC would call this Thursday.
    expect(sessionWeekday(NINE_PM_PACIFIC, PACIFIC)).toBe("Wednesday");
  });

  it("reports the room's date", () => {
    expect(sessionDate(NINE_PM_PACIFIC, PACIFIC)).toBe("Aug 26");
  });

  it("writes the long day the way a message would", () => {
    expect(sessionDayLong(NINE_PM_PACIFIC, PACIFIC)).toBe("Wednesday, Aug 26");
  });

  it("keeps the short day short", () => {
    expect(sessionDayShort(NINE_PM_PACIFIC, PACIFIC)).toMatch(/Wed/);
  });

  it("gives the hour in the room's zone", () => {
    expect(sessionHour(NINE_PM_PACIFIC, PACIFIC)).toMatch(/^9\s?PM$/i);
  });

  it("puts the day and the hour together", () => {
    const when = sessionWhen(NINE_PM_PACIFIC, PACIFIC);
    expect(when).toContain("Wednesday");
    expect(when).toContain("9:00 PM");
  });
});

/**
 * The zone is appended only when the reader is somewhere else.
 *
 * Asserted as an invariant against whatever zone this machine is in, rather
 * than by faking Intl — a stub deep enough to fool `zonesDiffer` was more
 * fragile than the rule it was checking, and would have broken on a library
 * change rather than on a real regression.
 */
describe("naming the zone", () => {
  it("stays quiet about the reader's own zone", () => {
    expect(sessionZoneLabel(NINE_PM_PACIFIC, viewerZone())).toBeNull();
    // The hour and nothing after it. A pattern for "no trailing capitals"
    // matched PM, which is the sort of test that passes for the wrong reason.
    expect(sessionTime(NINE_PM_PACIFIC, viewerZone())).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
  });

  /**
   * The case that matters: a practitioner reading "9:00 PM" about a room three
   * hours away has been told the wrong hour.
   */
  it("names a zone that is not the reader's", () => {
    const elsewhere = viewerZone() === "Asia/Tokyo" ? "America/Los_Angeles" : "Asia/Tokyo";

    expect(sessionZoneLabel(NINE_PM_PACIFIC, elsewhere)).not.toBeNull();
    expect(sessionTime(NINE_PM_PACIFIC, elsewhere)).toMatch(/[A-Z]{2,5}$|GMT[+-]\d/);
  });
});
