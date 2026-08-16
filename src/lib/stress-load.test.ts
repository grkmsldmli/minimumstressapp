import { describe, expect, it } from "vitest";

import {
  type Answers,
  type Dimension,
  BAND_COPY,
  DIMENSIONS,
  FIRST_STEP,
  QUESTIONS,
  bandFor,
  isComplete,
  scoreAnswers,
} from "./stress-load";

/** Every question answered with the same option index. */
function allAt(index: number): Answers {
  return Object.fromEntries(QUESTIONS.map((q) => [q.id, index]));
}

describe("the question set", () => {
  it("covers four dimensions evenly", () => {
    const counts = new Map<Dimension, number>();
    for (const question of QUESTIONS) {
      counts.set(question.dimension, (counts.get(question.dimension) ?? 0) + 1);
    }
    expect(QUESTIONS.length).toBe(12);
    expect([...counts.values()]).toEqual([3, 3, 3, 3]);
  });

  it("gives every question four options and a unique id", () => {
    const ids = new Set(QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(QUESTIONS.length);
    for (const question of QUESTIONS) {
      expect(question.options.length, question.id).toBe(4);
    }
  });

  /** Copy exists for every band and every dimension, or a result renders blank. */
  it("has wording for everything it can return", () => {
    for (const dimension of Object.keys(DIMENSIONS) as Dimension[]) {
      expect(FIRST_STEP[dimension], dimension).toBeTruthy();
    }
    for (const band of ["steady", "carrying", "low", "depleted"] as const) {
      expect(BAND_COPY[band].label, band).toBeTruthy();
      expect(BAND_COPY[band].body, band).toBeTruthy();
    }
  });
});

describe("scoring", () => {
  /*
   * Options are written best-first, so choosing the first answer everywhere is
   * the best possible week and the last answer everywhere is the worst. Higher
   * is better — the same direction as every other tool here, which the four
   * tests this replaces did not manage between them.
   */
  it("puts the best answers at 100 and the worst at 0", () => {
    expect(scoreAnswers(allAt(0)).score).toBe(100);
    expect(scoreAnswers(allAt(3)).score).toBe(0);
  });

  it("scores each dimension the same way", () => {
    const best = scoreAnswers(allAt(0));
    expect(best.dimensions).toEqual({ sleep: 100, body: 100, mind: 100, load: 100 });
  });

  it("lands the middle answers in the middle", () => {
    expect(scoreAnswers(allAt(1)).score).toBe(67);
    expect(scoreAnswers(allAt(2)).score).toBe(33);
  });

  /*
   * The failure this exists to stop. Worst possible on all three sleep
   * questions and best on the other nine averages 75, and a mean alone calls
   * that "holding up" — to somebody who has just described a week with no
   * sleep in it. The band is held to at most one step above the weakest
   * dimension, so it reads "running low" instead.
   */
  it("does not let a strong average hide a collapsed dimension", () => {
    const answers = { ...allAt(0) };
    for (const question of QUESTIONS.filter((q) => q.dimension === "sleep")) {
      answers[question.id] = 3;
    }

    const result = scoreAnswers(answers);
    expect(result.score).toBe(75);
    expect(bandFor(result.score)).toBe("steady");
    expect(result.band).toBe("low");
  });

  /** But three strong areas still count — the ceiling is one step, not zero. */
  it("does not pin the whole result to the worst answer either", () => {
    const answers = { ...allAt(0) };
    for (const question of QUESTIONS.filter((q) => q.dimension === "sleep")) {
      answers[question.id] = 2;
    }

    const result = scoreAnswers(answers);
    expect(result.dimensions.sleep).toBe(33);
    // Sleep alone is "low"; the other three lift the headline one step.
    expect(result.band).toBe("carrying");
  });

  it("leaves an even result alone", () => {
    expect(scoreAnswers(allAt(0)).band).toBe("steady");
    expect(scoreAnswers(allAt(3)).band).toBe("depleted");
  });

  it("finds the thinnest dimension", () => {
    const answers = { ...allAt(0) };
    // Worst possible on all three sleep questions, best everywhere else.
    for (const question of QUESTIONS.filter((q) => q.dimension === "sleep")) {
      answers[question.id] = 3;
    }

    const result = scoreAnswers(answers);
    expect(result.weakest).toBe("sleep");
    expect(result.dimensions.sleep).toBe(0);
    expect(result.dimensions.body).toBe(100);
  });

  /*
   * A partial set still scores what was answered rather than counting the
   * blanks as zero. Treating an unanswered question as the worst answer would
   * tell somebody who quit halfway that they are depleted.
   */
  it("does not count unanswered questions against you", () => {
    const partial: Answers = { [QUESTIONS[0].id]: 0 };
    expect(scoreAnswers(partial).score).toBe(100);
  });

  it("knows when the set is finished", () => {
    expect(isComplete({})).toBe(false);
    expect(isComplete({ [QUESTIONS[0].id]: 0 })).toBe(false);
    expect(isComplete(allAt(2))).toBe(true);
  });
});

describe("bands", () => {
  it("names each one", () => {
    expect(bandFor(100)).toBe("steady");
    expect(bandFor(60)).toBe("carrying");
    expect(bandFor(30)).toBe("low");
    expect(bandFor(10)).toBe("depleted");
  });

  it("holds at the boundaries", () => {
    expect(bandFor(75)).toBe("steady");
    expect(bandFor(74)).toBe("carrying");
    expect(bandFor(50)).toBe("carrying");
    expect(bandFor(49)).toBe("low");
    expect(bandFor(25)).toBe("low");
    expect(bandFor(24)).toBe("depleted");
  });

  /*
   * The lowest band is where somebody is most fragile, and it is the one the
   * old tests reached for "your nervous system is stuck in survival mode" on.
   * It has to point somewhere real instead.
   */
  it("points the lowest band at a person, not at a product", () => {
    expect(BAND_COPY.depleted.body).toContain("doctor");
    expect(BAND_COPY.depleted.body).not.toMatch(/session|book|buy/i);
  });
});
