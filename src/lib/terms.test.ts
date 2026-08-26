import { describe, expect, it } from "vitest";

import { ACCEPTANCE_POINTS, TERMS_VERSION, digestOf, hasAcceptedTerms, termsDigest } from "./terms";
import { SECTIONS } from "./legal-text";

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

/**
 * The substance, and where it now lives.
 *
 * These guards were written against ACCEPTANCE_POINTS, to stop the clauses the
 * business rests on being quietly dropped from the screen somebody agrees on.
 * The screen is now three lines and links to the document, so asserting them
 * there would fail for the right reason and the wrong one at once.
 *
 * So they moved rather than went. The document is what an acceptance is
 * recorded against — SECTIONS, published at /terms and /privacy — and it is
 * the honest place to insist these words exist. Asserted by substance rather
 * than exact wording, as before: rephrasing passes, deleting does not.
 */
describe("what somebody is agreeing to", () => {
  const document = SECTIONS.flatMap((s) => [s.title, ...s.points])
    .join(" ")
    .toLowerCase();

  it("excludes bookings made outside the app", () => {
    expect(document).toContain("outside the app");
    expect(document).toContain("not a party");
  });

  it("names the specific protections that do not apply", () => {
    for (const protection of ["payment protection", "refund", "access", "insurance", "dispute"]) {
      expect(document, protection).toContain(protection);
    }
  });

  it("places liability rather than only declining it", () => {
    expect(document).toContain("liability");
    expect(document).toContain("rests with the parties");
  });

  it("states the consequence of asking for contact details", () => {
    expect(document).toContain("suspension");
  });

  /** Independence, in the words that matter for employment status. */
  it("says the two sides contract with each other", () => {
    expect(document).toContain("contract with each other");
    expect(document).toContain("sublicense");
  });
});

/**
 * The screen itself, held short on purpose.
 *
 * The failure this guards is the one that produced the old version: every
 * clause anybody thought important gets added "just in case", and the screen
 * becomes a wall nobody reads — which is worse than a short one, because a
 * person who scrolls past four paragraphs has been informed of nothing.
 *
 * A ceiling rather than a floor, and a link out, so the full text is always a
 * tap away from the moment of agreeing.
 */
describe("the screen somebody agrees on", () => {
  it("stays short enough to read standing up", () => {
    expect(ACCEPTANCE_POINTS.length).toBeLessThanOrEqual(3);
    for (const point of ACCEPTANCE_POINTS) {
      expect(point.body.length, point.title).toBeLessThan(140);
    }
  });

  /*
   * Only things a person does. The entity name and the contracting position
   * are true, binding and published; neither changes what anybody does next,
   * which is what this screen is for.
   */
  it("carries only rules that change somebody's behaviour", () => {
    const shown = ACCEPTANCE_POINTS.map((p) => `${p.title} ${p.body}`).join(" ").toLowerCase();
    for (const boilerplate of ["llc", "consulting services", "sublicense", "indemn"]) {
      expect(shown, boilerplate).not.toContain(boilerplate);
    }
  });

  it("covers booking in the app, declared use, and the host's rules", () => {
    const shown = ACCEPTANCE_POINTS.map((p) => `${p.title} ${p.body}`).join(" ").toLowerCase();
    expect(shown).toContain("through minimum stress");
    expect(shown).toContain("declared");
    expect(shown).toContain("host");
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
    /*
     * Version 2 adds "What a space may be used for": the platform's list of
     * prohibited uses, the rule that a space is used only for what was
     * declared and by the number declared, and what we may do when it is not
     * — cancel, remove access, refuse a refund, suspend. That is a new
     * obligation on every user, so everybody is asked again.
     *
     * It also says what happens to the money on a studio that accepts
     * bookings itself: the card is held rather than charged, and the hold is
     * released if the host declines or never answers. Not a new obligation,
     * but a different thing happening to somebody's money than the line above
     * it describes, which is exactly what a payment term is for.
     *
     * And "contract with each other", which had only ever existed on the
     * acceptance screen. That screen is now three lines, so the clause moved
     * into the document where it belongs — the same words, in the text an
     * acceptance is actually recorded against.
     */
    2: "fffbd1f7",
    /*
     * Version 3 tightens the practitioner cancellation standing: a pause now
     * comes at three late cancellations in 90 days rather than six, and lasts
     * 7 days rather than 14. That is a stricter cancellation term — a change to
     * cancellation, which this file's own rule says raises the version — so
     * every practitioner is asked again. The host rule (three, 14 days) is
     * unchanged; only the practitioner lines and the shared "pauses lift" line
     * moved, along with the "seven days" and "shorter pause" wording.
     */
    3: "abc408a5",
    /*
     * Version 4 adds the identity-verification privacy disclosure: that we use
     * Stripe for identity verification, what Stripe may collect to run it (ID
     * and selfie images, identifying information, device and fraud signals),
     * that we store no copies of those images and keep only the status and a
     * reference, and how to ask for that data to be deleted or redacted. New
     * processing of a new category of personal data, so everyone is asked again.
     */
    4: "30c0ee0b",
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
