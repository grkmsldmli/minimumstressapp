import { describe, expect, it } from "vitest";

import { ACCEPTANCE_POINTS, TERMS_VERSION, digestOf, hasAcceptedTerms, termsDigest } from "./terms";

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

/**
 * What version 1 actually says, pinned.
 *
 * An acceptance stores a number. That answers "did they agree" and not the
 * question a dispute asks, which is agree to *what* — the text lives in code,
 * so producing it means trusting that nobody edited the words without raising
 * the number. This is the check that makes that trust unnecessary.
 *
 * If this fails you have changed the binding text. Two honest ways out:
 *
 *   - The change alters what somebody is agreeing to — a new obligation, a new
 *     liability, anything about money or cancellation. Raise TERMS_VERSION and
 *     update the digest. Everyone is asked again, which is the point.
 *   - It is a typo, punctuation, or a clearer phrasing of the same duty. Leave
 *     the version and update the digest here, deliberately, having decided
 *     that.
 *
 * What must not happen is the digest being updated without that decision being
 * made, which is why it is a constant in a committed file and not computed.
 */
describe("the words a version stands for", () => {
  /**
   * One line per version, appended and never edited.
   *
   * A stored acceptance holds a number. That answers "did they agree" and not
   * the question a dispute asks, which is agree to *what* — the text lives in
   * code, so producing what version 1 said means trusting that nobody changed
   * the words without raising the number.
   *
   * This is the record that makes the trust unnecessary, and it accumulates
   * rather than being overwritten: when TERMS_VERSION goes to 2, add a line.
   * The old one stays, so the repository permanently states which words each
   * version stood for, and git can produce them.
   */
  const DIGESTS: Record<number, string> = {
    1: "338e9ed4",
  };

  it("still says what the current version said", () => {
    expect(DIGESTS[TERMS_VERSION]).toBeDefined();
    expect(termsDigest()).toBe(DIGESTS[TERMS_VERSION]);
  });

  /**
   * If this fails you have changed the binding text. Two honest ways out:
   *
   *   - It changes what somebody is agreeing to — a new obligation, a new
   *     liability, anything about money or cancellation. Raise TERMS_VERSION
   *     and add a line above. Everyone is asked again, which is the point.
   *   - It is a typo or a clearer phrasing of the same duty. Update this
   *     version's digest, having decided that it is one.
   *
   * What must not happen is the number being updated without that decision,
   * which is why it is a constant in a committed file rather than computed.
   */
  it("keeps a line for every version ever issued", () => {
    for (let version = 1; version <= TERMS_VERSION; version++) {
      expect(DIGESTS[version], `version ${version} has no recorded digest`).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("changes the moment a single word does", () => {
    expect(digestOf("These terms are between you and us.")).not.toBe(
      digestOf("These terms are between you and them."),
    );
  });

  it("gives the same text the same fingerprint every time", () => {
    expect(digestOf("a booking is a booking")).toBe(digestOf("a booking is a booking"));
  });

  it("notices a clause being removed", () => {
    expect(digestOf("One. Two. Three.")).not.toBe(digestOf("One. Two."));
  });
});
