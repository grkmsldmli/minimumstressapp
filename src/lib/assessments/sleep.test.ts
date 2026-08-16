import { describe, expect, it } from "vitest";

import {
  DRAWN,
  SLEEP_BANDS,
  SLEEP_DIMENSIONS,
  SLEEP_POOL,
  type SleepDimension,
  type SleepType,
  drawSleepQuestions,
  isSleepComplete,
  scoreSleep,
  typeFor,
} from "./sleep";

describe("the pool", () => {
  it("came across whole", () => {
    expect(SLEEP_POOL.length).toBe(31);
  });

  it("gives every question four options and five dimensions of points each", () => {
    const keys: SleepDimension[] = ["A", "C", "Q", "R", "D"];
    for (const question of SLEEP_POOL) {
      expect(question.opts.length, question.q).toBe(4);
      expect(question.scores.length, question.q).toBe(4);
      for (const score of question.scores) {
        for (const key of keys) {
          expect(typeof score[key], `${question.q} → ${key}`).toBe("number");
        }
      }
    }
  });

  it("has no duplicates", () => {
    expect(new Set(SLEEP_POOL.map((q) => q.q)).size).toBe(SLEEP_POOL.length);
  });

  it("has wording for every band and every dimension", () => {
    for (const type of ["deep", "light", "cyclist", "dysregulated"] as SleepType[]) {
      expect(SLEEP_BANDS[type].title, type).toBeTruthy();
      expect(SLEEP_BANDS[type].desc, type).toBeTruthy();
    }
    for (const key of Object.keys(SLEEP_DIMENSIONS)) {
      expect(SLEEP_DIMENSIONS[key as SleepDimension], key).toBeTruthy();
    }
  });
});

describe("drawing", () => {
  it("takes twelve", () => {
    expect(drawSleepQuestions().length).toBe(DRAWN);
  });

  it("takes twelve different ones", () => {
    const drawn = drawSleepQuestions();
    expect(new Set(drawn.map((q) => q.q)).size).toBe(DRAWN);
  });

  it("does not draw the same twelve every time", () => {
    const runs = [0, 1, 2].map(() => drawSleepQuestions().map((q) => q.q).join("|"));
    expect(new Set(runs).size).toBeGreaterThan(1);
  });
});

describe("scoring", () => {
  const twelve = SLEEP_POOL.slice(0, 12);
  const allAt = (index: number) =>
    Object.fromEntries(twelve.map((_, position) => [position, index]));

  it("scores nothing when nothing is answered", () => {
    expect(scoreSleep(twelve, {}).overall).toBe(0);
  });

  /*
   * The bug this replaced: every dimension was divided by a fixed eighteen,
   * but twelve drawn questions spread over five dimensions give about seven
   * points each. The ceiling was around forty — so the healthiest possible
   * answers scored 40 and came back "Exhausted Cyclist", telling the best
   * sleeper the tool can describe that they were running a sleep debt.
   */
  it("reaches 100 when every answer is the healthiest one", () => {
    expect(scoreSleep(twelve, allAt(0)).overall).toBe(100);
  });

  it("reaches 0 when every answer is the worst", () => {
    expect(scoreSleep(twelve, allAt(3)).overall).toBe(0);
  });

  it("calls a perfect set of answers a deep restorer", () => {
    expect(scoreSleep(twelve, allAt(0)).type).toBe("deep");
  });

  /** And it holds for any twelve, not just the first twelve in the pool. */
  it("reaches 100 on a different draw too", () => {
    const other = SLEEP_POOL.slice(-12);
    const best = Object.fromEntries(other.map((_, position) => [position, 0]));
    expect(scoreSleep(other, best).overall).toBe(100);
  });

  /*
   * Only four of the thirty-one questions score sleep quality, so a draw of
   * twelve can easily contain none of them. Averaging over all five dimensions
   * regardless would score that one zero and take twenty points off the total
   * — marking somebody down for a question nobody asked them.
   */
  it("does not count a dimension the draw never asked about", () => {
    const withoutQ = SLEEP_POOL.filter((question) =>
      question.scores.every((score) => score.Q === 0),
    ).slice(0, 12);

    expect(withoutQ.length, "expected enough non-quality questions to build a draw").toBe(12);

    const best = Object.fromEntries(withoutQ.map((_, position) => [position, 0]));
    const result = scoreSleep(withoutQ, best);

    expect(result.dimensions.Q).toBe(0);
    expect(result.overall).toBe(100);
  });

  it("still reaches 100 across every possible draw of the best answers", () => {
    for (let start = 0; start + 12 <= SLEEP_POOL.length; start++) {
      const draw = SLEEP_POOL.slice(start, start + 12);
      const best = Object.fromEntries(draw.map((_, position) => [position, 0]));
      expect(scoreSleep(draw, best).overall, `draw from ${start}`).toBe(100);
    }
  });

  it("knows when it is finished", () => {
    expect(isSleepComplete(twelve, {})).toBe(false);
    expect(isSleepComplete(twelve, allAt(1))).toBe(true);
  });

  it("always returns a type that has wording behind it", () => {
    for (const index of [0, 1, 2, 3]) {
      const result = scoreSleep(twelve, allAt(index));
      expect(SLEEP_BANDS[result.type], `at ${index}`).toBeTruthy();
    }
  });
});

describe("typeFor — their chain, pinned as it is", () => {
  const dims = (over: Partial<Record<SleepDimension, number>> = {}) => ({
    A: 80,
    C: 80,
    Q: 80,
    R: 80,
    D: 80,
    ...over,
  });

  it("calls seventy and above a deep restorer", () => {
    expect(typeFor(70, dims())).toBe("deep");
    expect(typeFor(100, dims())).toBe("deep");
  });

  it("recognises the light sleeper pattern", () => {
    expect(typeFor(50, dims({ Q: 30, A: 30 }))).toBe("light");
  });

  it("recognises the exhausted cyclist pattern", () => {
    expect(typeFor(50, dims({ C: 30, D: 30 }))).toBe("cyclist");
  });

  /*
   * The behaviour worth having written down. The chain ends in `else`, so
   * anything under seventy that matches neither pattern lands on the worst of
   * the four labels — a 69 with no particular weakness is told its sleep
   * system needs a full reset.
   *
   * Kept because it is the original's, and pinned here so it is visible rather
   * than buried: this test failing later means somebody changed it on purpose.
   */
  it("falls through to the worst label for anything else", () => {
    expect(typeFor(69, dims())).toBe("dysregulated");
    expect(typeFor(65, dims({ Q: 45 }))).toBe("dysregulated");
  });
});
