import { describe, expect, it } from "vitest";

import { BADGES, badgesFor, countsTowardBadges } from "./badges";

const session = (over: Partial<Parameters<typeof countsTowardBadges>[0]> = {}) => ({
  practitionerId: "practitioner-1",
  hostId: "host-1",
  status: "completed",
  capturedAt: new Date("2026-08-04T12:00:00Z"),
  ...over,
});

describe("countsTowardBadges", () => {
  it("counts a paid session between two people", () => {
    expect(countsTowardBadges(session())).toBe(true);
  });

  /**
   * A badge that can be manufactured in an afternoon is worth nothing to
   * somebody who spent a year earning it.
   */
  it("refuses a session somebody booked from themselves", () => {
    expect(countsTowardBadges(session({ hostId: "practitioner-1" }))).toBe(false);
  });

  it.each(["upcoming", "cancelled_by_host", "cancelled_by_practitioner", "no_show"])(
    "refuses a %s booking",
    (status) => {
      expect(countsTowardBadges(session({ status }))).toBe(false);
    },
  );

  /** Status can say completed while nothing was ever charged. */
  it("refuses one that was never captured", () => {
    expect(countsTowardBadges(session({ capturedAt: null }))).toBe(false);
  });
});

describe("badgesFor", () => {
  it.each(["practitioner", "host"] as const)("gives a new %s nothing yet", (party) => {
    const progress = badgesFor(party, 0);
    expect(progress.earned).toEqual([]);
    expect(progress.next?.at).toBe(100);
    expect(progress.toNext).toBe(100);
  });

  it("awards exactly at the threshold, not before", () => {
    expect(badgesFor("practitioner", 99).earned).toHaveLength(0);
    expect(badgesFor("practitioner", 100).earned).toHaveLength(1);
  });

  it("keeps the earlier badges as later ones arrive", () => {
    const progress = badgesFor("host", 300);
    expect(progress.earned.map((b) => b.at)).toEqual([100, 250]);
    expect(progress.next?.at).toBe(500);
    expect(progress.toNext).toBe(200);
  });

  it("has nothing left to aim at once they are all earned", () => {
    const progress = badgesFor("practitioner", 900);
    expect(progress.earned).toHaveLength(3);
    expect(progress.next).toBeNull();
    expect(progress.toNext).toBe(0);
  });

  it("reports the session count it was given", () => {
    expect(badgesFor("host", 137).sessions).toBe(137);
  });
});

describe("the badges themselves", () => {
  it.each(["practitioner", "host"] as const)("orders %s badges by threshold", (party) => {
    const thresholds = BADGES[party].map((b) => b.at);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
  });

  /**
   * Spaced so each takes real time. Closer together and they stop meaning
   * anything; a hundred sessions is a year of weekly practice.
   */
  it("uses the same three thresholds on both sides", () => {
    expect(BADGES.practitioner.map((b) => b.at)).toEqual([100, 250, 500]);
    expect(BADGES.host.map((b) => b.at)).toEqual([100, 250, 500]);
  });

  it.each(["practitioner", "host"] as const)("says what each %s badge means", (party) => {
    for (const badge of BADGES[party]) {
      expect(badge.meaning.length, badge.key).toBeGreaterThan(20);
    }
  });
});
