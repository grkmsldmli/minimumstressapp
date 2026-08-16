import {
  BIO_COPY,
  BIO_DELTAS,
  BIO_SECTIONS,
  type BioDimension,
  type BioSection,
} from "./bio-age-data";

export {
  BIO_COPY,
  BIO_DELTAS,
  BIO_SECTIONS,
  type BioDimension,
  type BioSection,
} from "./bio-age-data";

/**
 * The model, exactly as the original ran it.
 *
 * Each dimension scores somewhere between minus its maximum and plus its
 * maximum. That position maps onto a range of years — sleep can move the
 * answer three years either way, substances five the wrong way and only two
 * the right way — and the years are added to the age somebody gave.
 *
 * The asymmetry on substances is the original's and it is defensible: quitting
 * does not buy back what smoking costs.
 */

export const MIN_AGE = 18;
export const MAX_AGE = 90;
/** The answer is clamped here, so a bad enough week cannot make somebody 130. */
const RESULT_FLOOR = 18;
const RESULT_CEILING = 100;

export type BioAnswers = Record<string, number>;

export interface BioResult {
  chronological: number;
  biological: number;
  /** Positive means older than the calendar. */
  difference: number;
  /** 0–100 per dimension, for the bars. */
  dimensions: Record<BioDimension, number>;
  strongest: BioDimension;
  weakest: BioDimension;
  secondWeakest: BioDimension;
}

export function answerKey(section: string, index: number): string {
  return `${section}:${index}`;
}

/**
 * A dimension's score, turned into years.
 *
 * The original had this the wrong way round, and it is the worst bug in any of
 * these tools. It read:
 *
 *     var pct = (score - (-max)) / (max * 2);
 *     return minD + (maxD - minD) * pct;
 *
 * with the ranges passed as (-3, 3), (-4, 4), (-5, 2) and so on. A high score
 * — the healthiest answers — produced the *positive* delta, and a low score
 * the negative one. So good habits added years and bad habits took them away.
 *
 * At the extremes: answering every question the healthiest way made a
 * forty-year-old sixty-one, and answering every one the worst way — smoking,
 * under six hours of sleep, sedentary, isolated — made them sixteen. The page
 * congratulated the person who most needed telling otherwise.
 *
 * The ranges are theirs and untouched; only the direction is corrected. A
 * score at the top of its range now lands on the negative end of the year
 * range, which is what "younger than your age" means.
 */
function scoreToDelta(score: number, max: number, minDelta: number, maxDelta: number): number {
  const position = (score - -max) / (max * 2);
  return maxDelta + (minDelta - maxDelta) * position;
}

/** 0–100 for a bar, from a score that runs from minus max to plus max. */
export function dimensionPercent(score: number, max: number): number {
  return Math.round(Math.max(0, Math.min(100, ((score + max) / (max * 2)) * 100)));
}

export function isBioComplete(answers: BioAnswers, age: string): boolean {
  const years = Number(age);
  if (!years || years < MIN_AGE || years > MAX_AGE) return false;
  return BIO_SECTIONS.every((section) =>
    section.questions.every((_, index) => answers[answerKey(section.key, index)] !== undefined),
  );
}

export function scoreBioAge(answers: BioAnswers, chronological: number): BioResult {
  const raw = {} as Record<BioDimension, number>;

  for (const section of BIO_SECTIONS) {
    let total = 0;
    section.questions.forEach((question, index) => {
      const chosen = answers[answerKey(section.key, index)];
      if (chosen !== undefined) total += question.scores[chosen];
    });
    raw[section.key] = total;
  }

  let years = 0;
  const dimensions = {} as Record<BioDimension, number>;

  for (const delta of BIO_DELTAS) {
    const score = raw[delta.key] ?? 0;
    years += scoreToDelta(score, delta.max, delta.min, delta.maxDelta);
    dimensions[delta.key] = dimensionPercent(score, delta.max);
  }

  const biological = Math.max(
    RESULT_FLOOR,
    Math.min(RESULT_CEILING, Math.round(chronological + years)),
  );

  const ranked = BIO_DELTAS.map((d) => d.key).sort((a, b) => dimensions[a] - dimensions[b]);

  return {
    chronological,
    biological,
    difference: biological - chronological,
    dimensions,
    strongest: ranked[ranked.length - 1],
    weakest: ranked[0],
    secondWeakest: ranked[1],
  };
}

/**
 * How the difference is described.
 *
 * Their five bands, and their thresholds. The wording is levelled a little at
 * the top end — the original opened the worst one with "your biological age is
 * accelerated", which is a clinical-sounding claim for a lifestyle
 * questionnaire to make about somebody's body.
 */
export function narrativeFor(difference: number): { badge: string; headline: string } {
  const years = Math.abs(difference);
  const plural = years === 1 ? "year" : "years";

  if (difference <= -8) {
    return {
      badge: `${years} ${plural} younger than your age`,
      headline: "Your habits are doing a lot of work for you.",
    };
  }
  if (difference <= -3) {
    return {
      badge: `${years} ${plural} younger than your age`,
      headline: "Your routine is protecting you.",
    };
  }
  if (difference <= 3) {
    return {
      badge: "About the same as your age",
      headline: "Keeping pace, without gaining ground.",
    };
  }
  if (difference <= 8) {
    return {
      badge: `${years} ${plural} older than your age`,
      headline: "Your habits are asking more of you than they give back.",
    };
  }
  return {
    badge: `${years} ${plural} older than your age`,
    headline: "This is the pattern worth changing first — and it is changeable.",
  };
}

export function sectionFor(key: BioDimension): BioSection | undefined {
  return BIO_SECTIONS.find((section) => section.key === key);
}

export function totalQuestions(): number {
  return BIO_SECTIONS.reduce((n, section) => n + section.questions.length, 0);
}

export { BIO_COPY as copy };
