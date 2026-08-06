import { describe, expect, it } from "vitest";

import { ACCEPTANCE_POINTS, TERMS_VERSION, hasAcceptedTerms } from "./terms";

/**
 * The commercial point of all this: "it was in the terms" is worth very little
 * without a record of the moment it was shown and taken.
 */
describe("hasAcceptedTerms", () => {
  it("asks an account that has never accepted anything", () => {
    expect(hasAcceptedTerms({ version: null })).toBe(false);
  });

  it("lets through an account on the current version", () => {
    expect(hasAcceptedTerms({ version: TERMS_VERSION })).toBe(true);
  });

  /**
   * An acceptance recorded against text somebody never saw is not an
   * acceptance. Raising the version is what asks everybody again.
   */
  it("asks again when the terms have moved on", () => {
    expect(hasAcceptedTerms({ version: TERMS_VERSION - 1 })).toBe(false);
  });

  /** A downgraded constant must not silently invalidate real acceptances. */
  it("accepts a version ahead of this build", () => {
    expect(hasAcceptedTerms({ version: TERMS_VERSION + 1 })).toBe(true);
  });
});

describe("what somebody is agreeing to", () => {
  const all = ACCEPTANCE_POINTS.map((p) => `${p.title} ${p.body}`).join(" ").toLowerCase();

  /**
   * The clause the business rests on. Asserted by what it must contain rather
   * than by its exact wording, so rephrasing it does not fail the test and
   * dropping the substance does.
   */
  it("excludes bookings made outside the app", () => {
    expect(all).toContain("outside the app");
    expect(all).toContain("not a party");
  });

  it("names the specific protections that do not apply", () => {
    // Vague exclusions are argued over. These are the things somebody would
    // actually come back asking for.
    for (const protection of ["payment protection", "refund", "access", "insurance", "dispute"]) {
      expect(all, protection).toContain(protection);
    }
  });

  it("places liability rather than only declining it", () => {
    expect(all).toContain("liability");
    expect(all).toContain("rests with the parties");
  });

  it("states the consequence of asking for contact details", () => {
    expect(all).toContain("suspension");
  });

  /** Independence, in the words that matter for employment status. */
  it("says the two sides contract with each other", () => {
    expect(all).toContain("contract with each other");
    expect(all).toContain("sublicense");
  });

  /**
   * Read on a phone, before a button. The liability clause is allowed to run
   * longer than the rest — an exclusion that leaves a gap is worse than one
   * that takes an extra line.
   */
  it("keeps every point short enough to be read", () => {
    for (const point of ACCEPTANCE_POINTS) {
      expect(point.body.length, point.title).toBeLessThan(320);
      expect(point.title.length, point.title).toBeLessThan(50);
    }
  });

  it("has no point that sounds like an opinion", () => {
    for (const phrase of ["we can only", "we would rather", "we invented", "we believe"]) {
      expect(all, phrase).not.toContain(phrase);
    }
  });
});
