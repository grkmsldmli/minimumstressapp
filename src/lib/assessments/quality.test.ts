import { describe, expect, it } from "vitest";

import { BIO_SECTIONS } from "./bio-age";
import { QUESTION_POOL } from "./burnout-data";
import { cortisol } from "./cortisol";
import { gut } from "./gut";
import { inflammation } from "./inflammation";
import { SLEEP_POOL } from "./sleep-data";

/**
 * What makes a question set usable, checked as structure rather than read.
 *
 * Reading fifteen hundred questions catches typos. It does not catch the
 * things that actually break a questionnaire, which are all structural: a
 * scale that does not run in one direction, two options worth the same score,
 * the same question drawn twice, a set where the best answer is not first.
 * Every one of those produces a result that looks perfectly reasonable and is
 * wrong, which is the only kind of bug that survives being looked at.
 */

/** Every question on the site, flattened, with somewhere to point when it fails. */
const ALL: { tool: string; text: string; opts: string[]; scores: number[] }[] = [
  ...[cortisol, gut, inflammation].flatMap((assessment) =>
    assessment.sections.flatMap((section) =>
      section.questions.map((question) => ({
        tool: `${assessment.slug}/${section.key}`,
        text: question.text,
        opts: question.opts,
        scores: question.scores,
      })),
    ),
  ),
  ...BIO_SECTIONS.flatMap((section) =>
    section.questions.map((question) => ({
      tool: `biological-age/${section.key}`,
      text: question.text,
      opts: question.opts,
      scores: question.scores,
    })),
  ),
  ...QUESTION_POOL.map((question) => ({
    tool: "burnout",
    text: question.q,
    opts: question.opts,
    scores: question.w,
  })),
  ...SLEEP_POOL.map((question) => ({
    tool: "sleep",
    text: question.q,
    // Sleep scores per dimension rather than as one number, so its options are
    // checked for shape here and its scale in its own file.
    opts: question.opts,
    scores: question.opts.map((_, index) => index),
  })),
];

describe("every question on the site", () => {
  it("has text, and options that are all different", () => {
    for (const question of ALL) {
      expect(question.text.trim().length, question.tool).toBeGreaterThan(0);
      expect(new Set(question.opts).size, `${question.tool}: ${question.text}`).toBe(
        question.opts.length,
      );
    }
  });

  it("has one score per option", () => {
    for (const question of ALL) {
      expect(question.scores.length, `${question.tool}: ${question.text}`).toBe(
        question.opts.length,
      );
    }
  });

  /*
   * The scale has to run one way. An option worth the same as its neighbour is
   * a choice that changes nothing — somebody picks the more accurate of the
   * two and the result does not move — and one that reverses means the answer
   * they gave counts as the opposite.
   */
  it("runs its scale in one direction, with no two options worth the same", () => {
    for (const question of ALL) {
      const { scores } = question;
      const descending = scores.every((value, i) => i === 0 || value < scores[i - 1]);
      const ascending = scores.every((value, i) => i === 0 || value > scores[i - 1]);
      expect(
        descending || ascending,
        `${question.tool}: "${question.text}" scores ${JSON.stringify(scores)}`,
      ).toBe(true);
    }
  });

  /*
   * Four options, everywhere. Not a house-style rule: a set that mixes three
   * and five weights the five-option questions differently without saying so,
   * because each contributes a larger share of its section's maximum.
   */
  it("offers four options", () => {
    for (const question of ALL) {
      expect(question.opts.length, `${question.tool}: ${question.text}`).toBe(4);
    }
  });

  /** An option nobody can read is an option nobody picks accurately. */
  it("keeps options short enough to compare at a glance", () => {
    for (const question of ALL) {
      for (const option of question.opts) {
        expect(option.length, `${question.tool}: "${option}"`).toBeLessThan(120);
      }
    }
  });
});

describe("the pools that get drawn from", () => {
  /*
   * The burnout test draws ten from a hundred and the sleep score twelve from
   * seventy. A duplicate in the pool can be drawn twice in one sitting, which
   * asks somebody the same thing twice and counts their answer twice.
   */
  it("has no duplicate question in the burnout pool", () => {
    const seen = new Map<string, number>();
    for (const question of QUESTION_POOL) {
      seen.set(question.q, (seen.get(question.q) ?? 0) + 1);
    }
    const repeated = [...seen].filter(([, count]) => count > 1).map(([text]) => text);
    expect(repeated).toEqual([]);
  });

  it("has no duplicate question in the sleep pool", () => {
    const seen = new Map<string, number>();
    for (const question of SLEEP_POOL) {
      seen.set(question.q, (seen.get(question.q) ?? 0) + 1);
    }
    const repeated = [...seen].filter(([, count]) => count > 1).map(([text]) => text);
    expect(repeated).toEqual([]);
  });

  /*
   * And the pool has to be big enough that two people do not get the same test.
   * Ten drawn from a hundred is what makes "a different test each time" true,
   * which the page says out loud.
   */
  it("keeps the pools large enough for the draw to mean something", () => {
    expect(QUESTION_POOL.length).toBeGreaterThanOrEqual(50);
    expect(SLEEP_POOL.length).toBeGreaterThanOrEqual(30);
  });
});

describe("the fixed sets", () => {
  /*
   * A question asked in two different tools is not automatically wrong —
   * sleep belongs in several of these — but the same *wording* twice means
   * somebody taking two of them is answering a duplicate, and should be
   * deliberate rather than accidental.
   */
  it("does not repeat wording between the sectioned assessments", () => {
    const byText = new Map<string, string[]>();
    for (const assessment of [cortisol, gut, inflammation]) {
      for (const section of assessment.sections) {
        for (const question of section.questions) {
          const list = byText.get(question.text) ?? [];
          list.push(assessment.slug);
          byText.set(question.text, list);
        }
      }
    }
    const shared = [...byText].filter(([, tools]) => new Set(tools).size > 1);
    expect(shared.map(([text]) => text)).toEqual([]);
  });
});
