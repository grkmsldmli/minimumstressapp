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
  it("says a session arranged off the app is their own", () => {
    const text = ACCEPTANCE_POINTS.map((p) => `${p.title} ${p.body}`).join(" ").toLowerCase();

    expect(text).toContain("outside minimum stress");
    expect(text).toContain("cannot help");
  });

  it("names what stops applying, not only the rule", () => {
    const text = ACCEPTANCE_POINTS.map((p) => p.body).join(" ").toLowerCase();

    // A refund, a door code and somebody to call: the three things a person
    // actually loses by taking a booking elsewhere.
    expect(text).toContain("refund");
    expect(text).toContain("door code");
    expect(text).toContain("call");
  });

  it("states the suspension consequence for asking for contact details", () => {
    const text = ACCEPTANCE_POINTS.map((p) => p.body).join(" ").toLowerCase();
    expect(text).toContain("suspended");
  });

  it("keeps each point short enough to be read", () => {
    for (const point of ACCEPTANCE_POINTS) {
      expect(point.body.length, point.title).toBeLessThan(260);
      expect(point.title.length, point.title).toBeLessThan(50);
    }
  });
});
