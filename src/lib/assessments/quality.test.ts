import { describe, expect, it } from "vitest";

import { BAND_COPY } from "../bmi";
import { FAT_BAND_COPY } from "../body-composition";
import { BIO_COPY, BIO_SECTIONS } from "./bio-age";
import { CATEGORY_INSIGHTS, PROFILES, QUESTION_POOL } from "./burnout-data";
import { cortisol } from "./cortisol";
import { BURNOUT_FOCUS, SECTION_FOCUS, SLEEP_FOCUS } from "./focus";
import { gut } from "./gut";
import { inflammation } from "./inflammation";
import { SLEEP_BANDS, SLEEP_POOL } from "./sleep-data";

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

describe("what the results are allowed to recommend", () => {
  /*
   * The company no longer has consultants and no longer sells sessions.
   *
   * Every one of these tools was written when it did, and each ended by
   * pointing somewhere: the burnout categories named the kind of practitioner
   * to book, the sectioned assessments ended in "Explore ..." buttons into a
   * catalogue that is closing, and the inflammation result recommended
   * naturopathic protocols. All of it has been replaced with something the
   * reader can do on their own — but the copy is long, it came over from
   * elsewhere, and the way this comes back is one sentence at a time.
   *
   * So this walks every string that can reach a reader. Pointing at a doctor
   * is fine and stays; pointing at a service we do not have is what fails.
   */
  const SELLING =
    /\b(coach|coaching|consultants?|practitioners?|naturopath\w*|herbalists?|our (team|experts))\b|book\s+(a|one)[^.]{0,40}\bsession\b/i;

  /** Everything a finished result can put on the page or in the email. */
  const COPY: { where: string; text: string }[] = [
    ...[cortisol, gut, inflammation].flatMap((assessment) =>
      Object.entries(assessment.bands).flatMap(([key, band]) =>
        [band.label, band.title, band.desc, ...band.insights].map((text) => ({
          where: `${assessment.slug}/${key}`,
          text,
        })),
      ),
    ),
    ...Object.entries(SLEEP_BANDS).flatMap(([key, band]) =>
      [band.label, band.title, band.desc, ...band.insights].map((text) => ({
        where: `sleep/${key}`,
        text,
      })),
    ),
    ...Object.entries(PROFILES).flatMap(([key, profile]) =>
      [
        profile.scoreNote,
        profile.storyTitle,
        profile.story,
        profile.patternTitle,
        profile.pattern,
        profile.scienceTitle,
        profile.science,
        profile.planTitle,
        profile.planText,
        ...profile.actions,
      ].map((text) => ({ where: `burnout/${key}`, text })),
    ),
    ...Object.entries(CATEGORY_INSIGHTS).flatMap(([key, insight]) =>
      [insight.label, insight.text].map((text) => ({ where: `burnout/${key}`, text })),
    ),
    ...Object.entries(BIO_COPY).flatMap(([key, copy]) =>
      [copy.strong, copy.mid, copy.weak, copy.science, copy.action].map((text) => ({
        where: `bio-age/${key}`,
        text,
      })),
    ),
    ...Object.entries({ ...SECTION_FOCUS, ...SLEEP_FOCUS, ...BURNOUT_FOCUS }).flatMap(
      ([key, focus]) =>
        [focus.label, focus.action].map((text) => ({ where: `focus/${key}`, text })),
    ),
    ...Object.entries(BAND_COPY).flatMap(([key, copy]) =>
      [copy.label, copy.body].map((text) => ({ where: `bmi/${key}`, text })),
    ),
    ...Object.entries(FAT_BAND_COPY).map(([key, text]) => ({ where: `body-fat/${key}`, text })),
  ];

  it("never sends anybody to a consultant we do not have", () => {
    const selling = COPY.filter(({ text }) => SELLING.test(text));
    expect(selling.map(({ where, text }) => `${where}: ${text}`)).toEqual([]);
  });

  /** And the guard is actually looking at something. */
  it("is reading the copy, not an empty list", () => {
    expect(COPY.length).toBeGreaterThan(150);
    expect(COPY.every(({ text }) => typeof text === "string" && text.length > 0)).toBe(true);
  });
});
