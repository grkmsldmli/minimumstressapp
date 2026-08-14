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
