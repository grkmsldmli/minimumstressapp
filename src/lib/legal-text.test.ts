import { describe, expect, it } from "vitest";

import { SECTIONS, sectionsFor } from "./legal-text";

/**
 * The binding text, and the split that publishes it.
 *
 * Acceptance is recorded against this array with a version, so what it
 * contains is not a content question — it is what somebody agreed to. The
 * failure worth guarding is quiet: a section whose scope is mistyped belongs
 * to neither document, disappears from both published pages, and nothing
 * anywhere reports a section that went missing.
 */
describe("the published legal text", () => {
  it("puts every section into exactly one document", () => {
    const published = [...sectionsFor("terms"), ...sectionsFor("privacy")];

    expect(published).toHaveLength(SECTIONS.length);
    expect(new Set(published.map((s) => s.key)).size).toBe(SECTIONS.length);
  });

  it("gives both documents something to say", () => {
    expect(sectionsFor("terms").length).toBeGreaterThan(0);
    expect(sectionsFor("privacy").length).toBeGreaterThan(0);
  });

  it("keeps the keys unique, since they are React keys and anchors", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
  });

  it("leaves no section without a title or a point to make", () => {
    for (const section of SECTIONS) {
      expect(section.title.trim()).not.toBe("");
      expect(section.points.length).toBeGreaterThan(0);
      for (const point of section.points) expect(point.trim()).not.toBe("");
    }
  });

  /**
   * Named parties, not "us". Terms that never say who the agreement is with
   * are weaker than terms that do — the reason company.ts exists as one
   * constant.
   */
  it("names the contracting entity in the terms", () => {
    const terms = sectionsFor("terms")
      .flatMap((s) => s.points)
      .join(" ");

    expect(terms).toContain("Minimum Stress Consulting Services LLC");
  });

  /**
   * California's ABC test governs worker classification, and language like
   * "we engage practitioners to..." would blur a relationship that is
   * structurally a customer renting space.
   */
  it("never describes a practitioner as engaged, hired or employed", () => {
    const everything = SECTIONS.flatMap((s) => s.points).join(" ").toLowerCase();

    // Affirmative constructions only. "not our worker" is the denial the
    // wording is built around, and the first version of this test failed on
    // it — which is the trap worth recording: the sentence that protects us
    // contains the words that would condemn us.
    expect(everything).not.toMatch(/\bwe (engage|hire|employ)\b/);
    expect(everything).not.toMatch(/\bour (practitioners|therapists|instructors)\b/);
    expect(everything).toContain("not our worker");
  });
});

/**
 * The disclosures a privacy policy is judged on.
 *
 * These were absent: no effective date, no named processors, no retention, no
 * rights, nothing about children. A policy without them reads as a summary of
 * intentions, and the company is a California LLC taking payments.
 *
 * Asserted as presence rather than wording, so the text can be improved
 * without the suite arguing about prose — but a section deleted wholesale
 * fails, which is the mistake worth catching.
 */
describe("what the privacy policy has to cover", () => {
  const privacy = sectionsFor("privacy")
    .flatMap((s) => s.points)
    .join(" ")
    .toLowerCase();

  it.each([
    ["the processors it sends data to", ["stripe", "supabase", "resend", "maptiler"]],
    ["how long things are kept", ["delete your account", "as long as the law requires"]],
    ["the rights somebody has", ["ask what we hold", "correct it", "45 days"]],
    ["that it is not for children", ["under 18"]],
    ["that nothing is sold", ["do not sell"]],
  ])("says %s", (_, phrases) => {
    for (const phrase of phrases) expect(privacy).toContain(phrase);
  });

  /**
   * Named rather than gestured at. "Trusted partners" is not a disclosure, and
   * a processor that is configured but switched off is worth saying so that
   * turning it on is a change to this text rather than a quiet extension of
   * who has somebody's number.
   */
  it("names the processor that is configured and unused", () => {
    expect(privacy).toContain("twilio");
    expect(privacy).toMatch(/twilio[^.]*not switched on|not switched on[^.]*twilio/);
  });
});
