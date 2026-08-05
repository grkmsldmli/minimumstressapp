import { describe, expect, it } from "vitest";

import type { Rating } from "./reviews";
import {
  POINTS,
  TIERS,
  type PointEvent,
  countsTowardPoints,
  hasBenefit,
  pointsFor,
  standingFor,
  totalPoints,
} from "./standing-points";

const NOW = new Date("2026-08-04T12:00:00Z");
const event = (kind: PointEvent["kind"], stars?: Rating): PointEvent => ({ kind, at: NOW, stars });

const session = (over: Partial<Parameters<typeof countsTowardPoints>[0]> = {}) => ({
  practitionerId: "practitioner-1",
  hostId: "host-1",
  status: "completed",
  capturedAt: NOW,
  ...over,
});

describe("countsTowardPoints", () => {
  it("counts a paid session between two people", () => {
    expect(countsTowardPoints(session())).toBe(true);
  });

  /**
   * The cheapest possible attack: a host with a second account books their own
   * room, both sides collect, and no money has left the pair. Every number on
   * the screen would be worthless.
   */
  it("refuses a session somebody booked from themselves", () => {
    expect(countsTowardPoints(session({ hostId: "practitioner-1" }))).toBe(false);
  });

  it.each(["upcoming", "cancelled_by_host", "cancelled_by_practitioner", "no_show"])(
    "refuses a %s booking",
    (status) => {
      expect(countsTowardPoints(session({ status }))).toBe(false);
    },
  );

  /** Status can say completed while nothing was ever charged. */
  it("refuses one that was never captured", () => {
    expect(countsTowardPoints(session({ capturedAt: null }))).toBe(false);
  });
});

describe("pointsFor", () => {
  it("values a completed session above everything else a single event can give", () => {
    const single = [
      pointsFor(event("perReviewStar", 5)),
      pointsFor(event("cleanSession")),
    ];
    expect(pointsFor(event("completedSession"))).toBeGreaterThan(Math.max(...single));
  });

  it.each([
    [1, 2],
    [3, 6],
    [5, 10],
  ])("scores %i stars as %i", (stars, expected) => {
    expect(pointsFor(event("perReviewStar", stars as Rating))).toBe(expected);
  });

  it("scores a review with no stars as nothing rather than NaN", () => {
    expect(pointsFor(event("perReviewStar"))).toBe(0);
  });

  /**
   * The asymmetry is the point: somebody was left without a room, and one
   * broken commitment should cost more than one kept one earns.
   */
  it("costs more to cancel late than a session is worth", () => {
    expect(Math.abs(POINTS.lateCancellation)).toBeGreaterThan(POINTS.completedSession);
  });

  it("costs more again for an upheld safety concern", () => {
    expect(POINTS.upheldSafetyConcern).toBeLessThan(POINTS.lateCancellation);
  });
});

describe("totalPoints", () => {
  it("adds up what happened", () => {
    expect(
      totalPoints([event("completedSession"), event("cleanSession"), event("perReviewStar", 5)]),
    ).toBe(27);
  });

  it("starts at nothing", () => {
    expect(totalPoints([])).toBe(0);
  });

  /**
   * A negative score keeps punishing after the punishment. Suspension is how
   * repeated cancellation is actually handled — this number is the encouraging
   * one and should not double as a second penalty.
   */
  it("never goes below zero", () => {
    expect(totalPoints([event("lateCancellation"), event("lateCancellation")])).toBe(0);
    expect(totalPoints([event("upheldSafetyConcern")])).toBe(0);
  });

  it("still lets a penalty bite when there is a balance to take it from", () => {
    const earned = Array.from({ length: 5 }, () => event("completedSession"));
    expect(totalPoints([...earned, event("lateCancellation")])).toBe(50);
  });
});

describe("standingFor", () => {
  it.each(["practitioner", "host"] as const)("starts %s at the first tier", (party) => {
    const standing = standingFor(party, 0);
    expect(standing.tier.key).toBe("new");
    expect(standing.next?.key).toBe("established");
  });

  it("moves up exactly at the threshold", () => {
    expect(standingFor("practitioner", 99).tier.key).toBe("new");
    expect(standingFor("practitioner", 100).tier.key).toBe("established");
  });

  it("reports what is still needed", () => {
    const standing = standingFor("host", 250);
    expect(standing.tier.key).toBe("established");
    expect(standing.next?.key).toBe("trusted");
    expect(standing.toNext).toBe(50);
  });

  it("fills the bar proportionally through a tier", () => {
    // Halfway between 100 and 300.
    expect(standingFor("practitioner", 200).progress).toBeCloseTo(0.5, 2);
  });

  it("tops out without a next tier", () => {
    const standing = standingFor("host", 10_000);
    expect(standing.tier.key).toBe("resident");
    expect(standing.next).toBeNull();
    expect(standing.toNext).toBe(0);
    expect(standing.progress).toBe(1);
  });

  it("never reports a progress outside the bar", () => {
    for (const points of [0, 1, 99, 100, 299, 300, 749, 750, 5000]) {
      const { progress } = standingFor("practitioner", points);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("the tiers themselves", () => {
  it.each(["practitioner", "host"] as const)("orders %s tiers by threshold", (party) => {
    const thresholds = TIERS[party].map((t) => t.at);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
  });

  /**
   * A ladder of names with nothing attached is a leaderboard, and a
   * leaderboard between people who need each other makes one of them look like
   * a worse bet for having joined later.
   */
  it.each(["practitioner", "host"] as const)("gives every %s tier a real benefit", (party) => {
    for (const tier of TIERS[party]) {
      expect(tier.benefit.length, tier.key).toBeGreaterThan(20);
    }
  });

  it("starts both ladders at zero, so nobody is behind on day one", () => {
    expect(TIERS.practitioner[0].at).toBe(0);
    expect(TIERS.host[0].at).toBe(0);
  });
});

describe("hasBenefit", () => {
  it("is true once the tier is reached", () => {
    expect(hasBenefit("host", 300, "trusted")).toBe(true);
    expect(hasBenefit("host", 299, "trusted")).toBe(false);
  });

  it("is false for a tier that does not exist", () => {
    expect(hasBenefit("host", 10_000, "platinum")).toBe(false);
  });
});
