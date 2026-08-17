import { describe, expect, it } from "vitest";

import { type SectionedResult, scoreSectioned } from "../sectioned";
import { SECTION_FOCUS, SLEEP_FOCUS, weakestSection, weakestSleep } from "./focus";
import { cortisol } from "./cortisol";
import { gut } from "./gut";
import { inflammation } from "./inflammation";
import { SLEEP_DIMENSIONS, type SleepDimension } from "./sleep-data";

const SECTIONED = [cortisol, gut, inflammation];

describe("every dimension has somewhere to start", () => {
  /*
   * The failure this catches is silent. A section key renamed in the extracted
   * data leaves the lookup returning undefined, the panel simply does not
   * render, and the result quietly goes back to being five numbers and no
   * steer — which is the thing this file exists to fix.
   */
  it("covers all fifteen sections across the three assessments", () => {
    for (const assessment of SECTIONED) {
      for (const section of assessment.sections) {
        const key = `${assessment.slug}:${section.key}`;
        expect(SECTION_FOCUS[key], key).toBeDefined();
        expect(SECTION_FOCUS[key].action.length, key).toBeGreaterThan(40);
      }
    }
  });

  it("covers all five sleep dimensions", () => {
    for (const key of Object.keys(SLEEP_DIMENSIONS) as SleepDimension[]) {
      expect(SLEEP_FOCUS[key], key).toBeDefined();
      expect(SLEEP_FOCUS[key].action.length, key).toBeGreaterThan(40);
    }
  });

  /** A heading beside a number needs to be a name, not a sentence. */
  it("keeps the bar labels short", () => {
    for (const focus of [...Object.values(SECTION_FOCUS), ...Object.values(SLEEP_FOCUS)]) {
      expect(focus.label.length, focus.label).toBeLessThanOrEqual(24);
    }
  });
});

describe("weakestSection", () => {
  const resultWith = (sections: Record<string, number>): SectionedResult => ({
    overall: 50,
    band: "x",
    sections,
  });

  /*
   * The direction is the whole point. Cortisol counts upward toward trouble
   * and gut health counts upward toward good, so "pick the lowest bar" sends
   * somebody carrying a high cortisol load off to work on their best area.
   */
  it("picks the highest where a high number is the problem", () => {
    expect(cortisol.higherIsBetter).toBe(false);
    expect(
      weakestSection(
        cortisol,
        resultWith({ morning: 20, stress: 90, energy: 30, sleep: 10, load: 40 }),
      ),
    ).toBe("stress");
  });

  it("picks the lowest where a high number is good news", () => {
    expect(gut.higherIsBetter).toBe(true);
    expect(
      weakestSection(
        gut,
        resultWith({ digestion: 80, microbiome: 15, gutbrain: 60, inflammation: 70, lifestyle: 90 }),
      ),
    ).toBe("microbiome");
  });

  it("returns null when nothing has been scored", () => {
    expect(weakestSection(cortisol, resultWith({}))).toBeNull();
  });

  /** Whatever comes out of the scorer must be a key the copy has. */
  it("names a section the copy covers, for a real run", () => {
    for (const assessment of SECTIONED) {
      const answers = Object.fromEntries(
        assessment.sections.flatMap((section) =>
          section.questions.map((_, index) => [`${section.key}:${index}`, 1]),
        ),
      );
      const weakest = weakestSection(assessment, scoreSectioned(assessment, answers));
      expect(SECTION_FOCUS[`${assessment.slug}:${weakest}`], assessment.slug).toBeDefined();
    }
  });
});

describe("weakestSleep", () => {
  it("picks the lowest, since sleep only runs one way", () => {
    expect(weakestSleep({ A: 80, C: 60, Q: 22, R: 55, D: 90 })).toBe("Q");
  });

  it("still names one when everything is level", () => {
    expect(SLEEP_FOCUS[weakestSleep({ A: 50, C: 50, Q: 50, R: 50, D: 50 })]).toBeDefined();
  });
});
