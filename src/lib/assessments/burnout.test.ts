import { describe, expect, it } from "vitest";

// Straight from the data file: `CATEGORIES` is no longer exported from
// ./burnout, because it is the consultant directory and nothing renders it any
// more. The keys are still what the questions are tagged with, which is all
// this file uses it for.
import { CATEGORIES } from "./burnout-data";
import {
  type BurnoutCategory,
  CATEGORY_INSIGHTS,
  DRAWN,
  PROFILES,
  QUESTION_POOL,
  categoriesToShow,
  drawQuestions,
  levelFor,
  scoreBurnout,
} from "./burnout";

/**
 * The hundred questions came out of the original script rather than being
 * retyped, so what is worth checking is that the pool is intact and that the
 * scoring still behaves the way the page it replaces did.
 */

describe("the question pool", () => {
  it("still has all hundred", () => {
    expect(QUESTION_POOL.length).toBe(100);
  });

  it("gives every question four options and four weights", () => {
    for (const question of QUESTION_POOL) {
      expect(question.opts.length, question.q).toBe(4);
      expect(question.w, question.q).toEqual([0, 1, 2, 3]);
    }
  });

  it("tags every question with at least one category", () => {
    for (const question of QUESTION_POOL) {
      expect(question.tags.length, question.q).toBeGreaterThan(0);
    }
  });

  /** A tag with no wording behind it renders an empty card at the end. */
  it("only uses categories that have copy", () => {
    const known = new Set(Object.keys(CATEGORIES));
    for (const question of QUESTION_POOL) {
      for (const tag of question.tags) {
        expect(known, `${question.q} → ${tag}`).toContain(tag);
        expect(CATEGORY_INSIGHTS[tag], tag).toBeTruthy();
      }
    }
  });

  it("has no duplicate questions", () => {
    const seen = new Set(QUESTION_POOL.map((q) => q.q));
    expect(seen.size).toBe(QUESTION_POOL.length);
  });
});

describe("drawing", () => {
  it("takes ten", () => {
    expect(drawQuestions().length).toBe(DRAWN);
  });

  it("takes ten different ones", () => {
    const drawn = drawQuestions();
    expect(new Set(drawn.map((q) => q.q)).size).toBe(DRAWN);
  });

  /** The whole reason for a pool: two attempts should not be the same test. */
  it("does not draw the same ten every time", () => {
    const a = drawQuestions().map((q) => q.q).join("|");
    const b = drawQuestions().map((q) => q.q).join("|");
    const c = drawQuestions().map((q) => q.q).join("|");
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });
});

describe("scoring", () => {
  const ten = QUESTION_POOL.slice(0, 10);
  const allAt = (index: number) =>
    Object.fromEntries(ten.map((_, position) => [position, index]));

  /*
   * Their direction, kept: the first option is the healthiest and scores zero,
   * the last is the most strained and scores three. So a high percentage means
   * more burnout — the opposite way round from a score where high is good, and
   * the reason the bands are named on the page rather than left as a number.
   */
  it("scores the healthiest answers at 0 and the most strained at 100", () => {
    expect(scoreBurnout(ten, allAt(0)).percent).toBe(0);
    expect(scoreBurnout(ten, allAt(3)).percent).toBe(100);
  });

  it("lands the middle answers in the middle", () => {
    expect(scoreBurnout(ten, allAt(1)).percent).toBe(33);
    expect(scoreBurnout(ten, allAt(2)).percent).toBe(67);
  });

  /*
   * Unanswered questions are left out of the denominator rather than counted
   * as zero. Counting them as the healthiest answer would tell somebody who
   * quit after two questions that they are fine.
   */
  it("scores only what was answered", () => {
    expect(scoreBurnout(ten, { 0: 3 }).percent).toBe(100);
  });

  it("ranks the categories the answers pointed at", () => {
    const result = scoreBurnout(ten, allAt(3));
    expect(result.ranked.length).toBe(4);
    // Sorted heaviest first.
    for (let i = 1; i < result.ranked.length; i++) {
      expect(result.ranked[i - 1].weight).toBeGreaterThanOrEqual(result.ranked[i].weight);
    }
  });

  it("gives every category zero weight when nothing is strained", () => {
    const result = scoreBurnout(ten, allAt(0));
    for (const entry of result.ranked) expect(entry.weight).toBe(0);
  });
});

describe("levels", () => {
  /** Their thresholds, unchanged. */
  it("holds at 35 and 65", () => {
    expect(levelFor(0)).toBe("low");
    expect(levelFor(34)).toBe("low");
    expect(levelFor(35)).toBe("mid");
    expect(levelFor(64)).toBe("mid");
    expect(levelFor(65)).toBe("high");
    expect(levelFor(100)).toBe("high");
  });

  it("names more places to look the worse it gets", () => {
    expect(categoriesToShow("low")).toBe(1);
    expect(categoriesToShow("mid")).toBe(2);
    expect(categoriesToShow("high")).toBe(3);
  });

  it("has a full profile for each level", () => {
    for (const level of ["low", "mid", "high"] as const) {
      const profile = PROFILES[level];
      expect(profile.storyTitle, level).toBeTruthy();
      expect(profile.story, level).toBeTruthy();
      expect(profile.actions.length, level).toBeGreaterThan(0);
      expect(profile.chips.length, level).toBeGreaterThan(0);
    }
  });

  /*
   * The reading of each category, which is what the page shows. What it no
   * longer shows is `CATEGORIES[…].desc` — the paragraph naming the kind of
   * consultant to book — because there are no consultants to book. See
   * BURNOUT_FOCUS in ./focus, which is what took its place.
   */
  it("has wording for every category", () => {
    for (const category of Object.keys(CATEGORIES) as BurnoutCategory[]) {
      expect(CATEGORY_INSIGHTS[category].label, category).toBeTruthy();
      expect(CATEGORY_INSIGHTS[category].text, category).toBeTruthy();
    }
  });
});
