import { describe, expect, it } from "vitest";

import {
  type BioAnswers,
  type BioDimension,
  BIO_COPY,
  BIO_DELTAS,
  BIO_SECTIONS,
  MAX_AGE,
  MIN_AGE,
  answerKey,
  dimensionPercent,
  isBioComplete,
  narrativeFor,
  scoreBioAge,
  totalQuestions,
} from "./bio-age";

/** Every question answered with the option at `index`, clamped per question. */
function allAt(index: number): BioAnswers {
  const answers: BioAnswers = {};
  for (const section of BIO_SECTIONS) {
    section.questions.forEach((question, i) => {
      answers[answerKey(section.key, i)] = Math.min(index, question.opts.length - 1);
    });
  }
  return answers;
}

describe("the model came across", () => {
  it("has seven dimensions, each with a delta range", () => {
    expect(BIO_DELTAS.length).toBe(7);
    for (const delta of BIO_DELTAS) {
      expect(delta.max, delta.key).toBeGreaterThan(0);
      expect(delta.min, delta.key).toBeLessThan(0);
      expect(delta.maxDelta, delta.key).toBeGreaterThan(0);
    }
  });

  it("has a section and full wording for every dimension", () => {
    for (const delta of BIO_DELTAS) {
      const section = BIO_SECTIONS.find((s) => s.key === delta.key);
      expect(section, delta.key).toBeTruthy();
      const copy = BIO_COPY[delta.key];
      expect(copy.name, delta.key).toBeTruthy();
      expect(copy.action, delta.key).toBeTruthy();
      expect(copy.weak, delta.key).toBeTruthy();
    }
  });

  it("keeps every question with its options and scores lined up", () => {
    for (const section of BIO_SECTIONS) {
      for (const question of section.questions) {
        expect(question.opts.length, question.text).toBe(question.scores.length);
        expect(question.text).toBeTruthy();
      }
    }
  });

  /*
   * Substances can add five years and remove only two. That asymmetry is the
   * original's and it is right: quitting does not buy back what smoking cost.
   */
  it("keeps the asymmetry on substances", () => {
    const substances = BIO_DELTAS.find((d) => d.key === "substances");
    expect(substances?.min).toBe(-5);
    expect(substances?.maxDelta).toBe(2);
  });
});

describe("scoring", () => {
  /*
   * The bug this replaced, and the worst one in any of these tools. The
   * original mapped a high score onto the positive year delta, so healthy
   * answers added years and unhealthy ones removed them: every question
   * answered the healthiest way made a forty-year-old sixty-one, and every one
   * answered the worst way — smoking, under six hours, sedentary, isolated —
   * made them sixteen. It congratulated the person who most needed telling
   * otherwise.
   */
  it("makes the healthiest answers younger than the calendar", () => {
    const result = scoreBioAge(allAt(0), 40);
    expect(result.biological).toBeLessThan(40);
    expect(result.difference).toBeLessThan(0);
  });

  it("makes the worst answers older", () => {
    const result = scoreBioAge(allAt(3), 40);
    expect(result.biological).toBeGreaterThan(40);
    expect(result.difference).toBeGreaterThan(0);
  });

  /** And the gap between the two is the whole range the model can express. */
  it("separates the two extremes by decades, in the right direction", () => {
    const best = scoreBioAge(allAt(0), 40).biological;
    const worst = scoreBioAge(allAt(3), 40).biological;
    expect(worst).toBeGreaterThan(best);
    expect(worst - best).toBeGreaterThan(20);
  });

  /*
   * The floor and ceiling matter more than they look. Without them a
   * twenty-year-old answering well comes out in their single digits, and the
   * page hands somebody a number that is obviously nonsense — which discredits
   * the rest of it.
   */
  it("never returns an age below eighteen or above a hundred", () => {
    expect(scoreBioAge(allAt(0), 18).biological).toBeGreaterThanOrEqual(18);
    expect(scoreBioAge(allAt(3), 90).biological).toBeLessThanOrEqual(100);
  });

  it("names the thinnest and strongest dimensions", () => {
    const answers = { ...allAt(0) };
    const sleep = BIO_SECTIONS.find((s) => s.key === "sleep");
    sleep?.questions.forEach((question, index) => {
      answers[answerKey("sleep", index)] = question.opts.length - 1;
    });

    const result = scoreBioAge(answers, 40);
    expect(result.weakest).toBe("sleep");
    expect(result.strongest).not.toBe("sleep");
    expect(result.secondWeakest).not.toBe(result.weakest);
  });

  it("scores each dimension somewhere on a bar", () => {
    const result = scoreBioAge(allAt(1), 35);
    for (const key of Object.keys(result.dimensions) as BioDimension[]) {
      expect(result.dimensions[key], key).toBeGreaterThanOrEqual(0);
      expect(result.dimensions[key], key).toBeLessThanOrEqual(100);
    }
  });

  it("puts the best and worst answers at the ends of the bars", () => {
    expect(dimensionPercent(8, 8)).toBe(100);
    expect(dimensionPercent(-8, 8)).toBe(0);
    expect(dimensionPercent(0, 8)).toBe(50);
  });
});

describe("completeness", () => {
  it("needs an age inside the range", () => {
    expect(isBioComplete(allAt(1), "")).toBe(false);
    expect(isBioComplete(allAt(1), String(MIN_AGE - 1))).toBe(false);
    expect(isBioComplete(allAt(1), String(MAX_AGE + 1))).toBe(false);
    expect(isBioComplete(allAt(1), "40")).toBe(true);
  });

  it("needs every question", () => {
    const partial = { ...allAt(1) };
    delete partial[answerKey(BIO_SECTIONS[0].key, 0)];
    expect(isBioComplete(partial, "40")).toBe(false);
  });

  it("counts the questions it asks", () => {
    expect(totalQuestions()).toBe(BIO_SECTIONS.reduce((n, s) => n + s.questions.length, 0));
  });
});

describe("the wording", () => {
  it("bands the difference their way", () => {
    expect(narrativeFor(-10).badge).toContain("younger");
    expect(narrativeFor(-5).badge).toContain("younger");
    expect(narrativeFor(0).badge).toContain("About the same");
    expect(narrativeFor(5).badge).toContain("older");
    expect(narrativeFor(12).badge).toContain("older");
  });

  it("says year rather than years when it is one", () => {
    expect(narrativeFor(-4).badge).toContain("4 years");
    expect(narrativeFor(4).badge).toContain("4 years");
  });

  /*
   * The original opened the worst band with "your biological age is
   * accelerated" — a clinical-sounding claim for a lifestyle questionnaire to
   * make about somebody's body. It points at what can change instead.
   */
  it("does not make a clinical claim at the worst end", () => {
    const worst = narrativeFor(15).headline;
    expect(worst).not.toMatch(/accelerated|damage|disease/i);
    expect(worst).toMatch(/changeable/i);
  });
});
