import { describe, expect, it } from "vitest";

import { cortisol } from "./assessments/cortisol";
import { gut } from "./assessments/gut";
import { inflammation } from "./assessments/inflammation";
import {
  type SectionedAssessment,
  answerKey,
  bandFor,
  isComplete,
  scoreSectioned,
} from "./sectioned";

const ALL: [string, SectionedAssessment][] = [
  ["cortisol", cortisol],
  ["gut", gut],
  ["inflammation", inflammation],
];

/** Every question answered with the option at `index`. */
function allAt(assessment: SectionedAssessment, index: number) {
  const answers: Record<string, number> = {};
  for (const section of assessment.sections) {
    section.questions.forEach((_, i) => {
      answers[answerKey(section.key, i)] = index;
    });
  }
  return answers;
}

describe.each(ALL)("%s: the questions came across intact", (name, assessment) => {
  it("has five sections of three", () => {
    expect(assessment.sections.length, name).toBe(5);
    for (const section of assessment.sections) {
      expect(section.questions.length, section.key).toBe(3);
    }
  });

  it("gives every question four options and four scores", () => {
    for (const section of assessment.sections) {
      for (const question of section.questions) {
        expect(question.opts.length, question.text).toBe(4);
        expect(question.scores.length, question.text).toBe(4);
      }
    }
  });

  it("has text on every question and section", () => {
    for (const section of assessment.sections) {
      expect(section.title, section.key).toBeTruthy();
      expect(section.sub, section.key).toBeTruthy();
      for (const question of section.questions) {
        expect(question.text, section.key).toBeTruthy();
        for (const option of question.opts) expect(option).toBeTruthy();
      }
    }
  });

  /** A band with no wording behind it renders an empty result panel. */
  it("has wording for every band it can return", () => {
    for (const [, band] of assessment.thresholds) {
      expect(assessment.bands[band], band).toBeTruthy();
      expect(assessment.bands[band].title, band).toBeTruthy();
      expect(assessment.bands[band].desc, band).toBeTruthy();
    }
  });

  it("orders the thresholds highest first and reaches zero", () => {
    const minimums = assessment.thresholds.map(([minimum]) => minimum);
    expect([...minimums].sort((a, b) => b - a), name).toEqual(minimums);
    expect(minimums[minimums.length - 1]).toBe(0);
  });
});

describe.each(ALL)("%s: scoring", (name, assessment) => {
  it("runs from 0 to 100", () => {
    const best = assessment.higherIsBetter ? 0 : 3;
    const worst = assessment.higherIsBetter ? 3 : 0;
    expect(scoreSectioned(assessment, allAt(assessment, best)).overall, name).toBe(100);
    expect(scoreSectioned(assessment, allAt(assessment, worst)).overall, name).toBe(0);
  });

  it("scores every section too", () => {
    const result = scoreSectioned(assessment, allAt(assessment, 0));
    expect(Object.keys(result.sections).length).toBe(assessment.sections.length);
  });

  it("knows when it is finished", () => {
    expect(isComplete(assessment, {})).toBe(false);
    expect(isComplete(assessment, allAt(assessment, 1))).toBe(true);
  });

  it("returns a band that has wording", () => {
    for (const index of [0, 1, 2, 3]) {
      const result = scoreSectioned(assessment, allAt(assessment, index));
      expect(assessment.bands[result.band], `${name} at ${index}`).toBeTruthy();
    }
  });
});

describe("bandFor", () => {
  /*
   * Their thresholds, kept. Cortisol runs the other way from the two below it,
   * which is the whole reason a band name is printed beside every number: a
   * bare 68 is "high cortisol load" on one page and "gut doing well" on
   * another, and nobody should have to remember which is which.
   */
  it("uses the cortisol thresholds", () => {
    expect(bandFor(cortisol, 68)).toBe("dysregulated");
    expect(bandFor(cortisol, 67)).toBe("elevated");
    expect(bandFor(cortisol, 38)).toBe("elevated");
    expect(bandFor(cortisol, 37)).toBe("balanced");
  });

  it("uses the gut thresholds", () => {
    expect(bandFor(gut, 75)).toBe("thriving");
    expect(bandFor(gut, 74)).toBe("moderate");
    expect(bandFor(gut, 49)).toBe("compromised");
    expect(bandFor(gut, 24)).toBe("critical");
  });

  it("uses the inflammation thresholds", () => {
    expect(bandFor(inflammation, 75)).toBe("low");
    expect(bandFor(inflammation, 50)).toBe("moderate");
    expect(bandFor(inflammation, 25)).toBe("high");
    expect(bandFor(inflammation, 24)).toBe("critical");
  });

  it("records which way each one points", () => {
    expect(cortisol.higherIsBetter).toBe(false);
    expect(gut.higherIsBetter).toBe(true);
    expect(inflammation.higherIsBetter).toBe(true);
  });
});
