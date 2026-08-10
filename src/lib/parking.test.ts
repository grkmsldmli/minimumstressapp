import { describe, expect, it } from "vitest";

import { SESSION_MINUTES } from "./session";
import { limitOutlastsSession, parkingFacts, type Parking } from "./parking";

const parking = (over: Partial<Parking> = {}): Parking => ({
  options: ["street"],
  limitMinutes: null,
  ...over,
});

describe("what a practitioner is told about parking", () => {
  /**
   * Silent rather than "not answered". Unlike a doorway width, an unanswered
   * parking question strands nobody — it costs a lap of the block — and a
   * listing that announces every blank field reads as a complaint about the
   * host.
   */
  it("says nothing when the host has not answered", () => {
    expect(parkingFacts(parking({ options: [] }))).toEqual([]);
  });

  it("lists every kind that applies", () => {
    const facts = parkingFacts(parking({ options: ["lot", "street", "free"] }));

    expect(facts.map((f) => f.answer)).toEqual(["Private lot", "Street parking", "Free"]);
    expect(facts.every((f) => !f.warns)).toBe(true);
  });

  /** Its own answer, and it replaces the rest rather than sitting beside them. */
  it("says no parking plainly, and warns", () => {
    expect(parkingFacts(parking({ options: ["none"] }))).toEqual([
      { answer: "No parking at this address", warns: true },
    ]);
  });

  it("keeps no parking from being listed alongside a lot", () => {
    // Reachable only from bad data — both pickers refuse it — and the honest
    // reading of a contradiction is the more cautious one.
    expect(parkingFacts(parking({ options: ["lot", "none"] }))).toEqual([
      { answer: "No parking at this address", warns: true },
    ]);
  });

  it("spells the time limit in the units somebody thinks in", () => {
    expect(parkingFacts(parking({ limitMinutes: 30 })).at(-1)?.answer).toBe("30 minutes maximum");
    expect(parkingFacts(parking({ limitMinutes: 60 })).at(-1)?.answer).toBe("1 hour maximum");
    expect(parkingFacts(parking({ limitMinutes: 120 })).at(-1)?.answer).toBe("2 hours maximum");
    expect(parkingFacts(parking({ limitMinutes: 90 })).at(-1)?.answer).toBe("1.5 hours maximum");
  });

  it("says nothing about a limit that does not exist", () => {
    expect(parkingFacts(parking({ limitMinutes: null })).some((f) => /maximum/.test(f.answer))).toBe(
      false,
    );
  });
});

describe("a limit that runs out mid-session", () => {
  /**
   * The reason this field exists. An hour-long session on an hour-long limit
   * is not tight, it is a car that has to be moved before the session ends —
   * and the limit starts when the car is parked, not when the session does.
   */
  it("warns when the car has to move before the session ends", () => {
    expect(limitOutlastsSession(SESSION_MINUTES)).toBe(false);
    expect(limitOutlastsSession(30)).toBe(false);
  });

  it("allows for arriving a few minutes early", () => {
    expect(limitOutlastsSession(SESSION_MINUTES + 10)).toBe(false);
    expect(limitOutlastsSession(SESSION_MINUTES + 15)).toBe(true);
  });

  it("treats no limit as no problem", () => {
    expect(limitOutlastsSession(null)).toBe(true);
  });

  it("carries the warning onto the listing", () => {
    const tight = parkingFacts(parking({ limitMinutes: 60 })).at(-1);
    const roomy = parkingFacts(parking({ limitMinutes: 120 })).at(-1);

    expect(tight?.warns).toBe(true);
    expect(roomy?.warns).toBe(false);
  });
});
