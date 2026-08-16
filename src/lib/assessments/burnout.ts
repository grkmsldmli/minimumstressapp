import {
  type BurnoutCategory,
  type BurnoutLevel,
  type BurnoutQuestion,
  CATEGORIES,
  PROFILES,
  QUESTION_POOL,
} from "./burnout-data";

export {
  CATEGORIES,
  CATEGORY_INSIGHTS,
  PROFILES,
  QUESTION_POOL,
  type BurnoutCategory,
  type BurnoutLevel,
  type BurnoutQuestion,
} from "./burnout-data";

/**
 * Scoring, exactly as the original did it.
 *
 * Ten questions drawn from the hundred, each worth 0 to 3, and the total as a
 * percentage of thirty. Note the direction: here a high score means more
 * burnout, which is the opposite of a BMI page where high is bad in a
 * different way again. It is kept because it is theirs and because the bands
 * are named — nobody reads "68" on this page and has to guess, they read
 * "burnt out".
 *
 * The category tags accumulate the same way. A question about sleep carries
 * `physical` and `traditional`, so answering it badly raises both, and the
 * heaviest categories are what the result points at.
 */

export const DRAWN = 10;
const MAX_PER_QUESTION = 3;

export interface BurnoutResult {
  /** 0–100. Higher means more strain, which is their direction. */
  percent: number;
  level: BurnoutLevel;
  /** Category totals, heaviest first. */
  ranked: { category: BurnoutCategory; weight: number }[];
}

/** Their thresholds: under 35 recovering, under 65 burning, else burnt out. */
export function levelFor(percent: number): BurnoutLevel {
  if (percent < 35) return "low";
  if (percent < 65) return "mid";
  return "high";
}

export const LEVEL_LABEL: Record<BurnoutLevel, string> = {
  low: "Recovering",
  mid: "Burning",
  high: "Burnt out",
};

/**
 * Ten at random, which is what makes the test worth taking twice.
 *
 * A caller passes its own shuffle so a test can be deterministic; the page
 * uses the default.
 */
export function drawQuestions(
  pool: BurnoutQuestion[] = QUESTION_POOL,
  shuffle: (items: BurnoutQuestion[]) => BurnoutQuestion[] = defaultShuffle,
): BurnoutQuestion[] {
  return shuffle(pool).slice(0, DRAWN);
}

function defaultShuffle(items: BurnoutQuestion[]): BurnoutQuestion[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * @param questions the ten that were drawn
 * @param answers   the option index chosen for each, by position
 */
export function scoreBurnout(
  questions: BurnoutQuestion[],
  answers: Record<number, number>,
): BurnoutResult {
  const weights: Record<BurnoutCategory, number> = {
    physical: 0,
    traditional: 0,
    social: 0,
    spiritual: 0,
  };

  let total = 0;
  let answered = 0;

  questions.forEach((question, index) => {
    const chosen = answers[index];
    if (chosen === undefined) return;

    const points = question.w[chosen];
    total += points;
    answered += 1;
    for (const tag of question.tags) weights[tag] += points;
  });

  const percent = Math.round((total / (answered * MAX_PER_QUESTION || 1)) * 100);

  const ranked = (Object.keys(weights) as BurnoutCategory[])
    .map((category) => ({ category, weight: weights[category] }))
    .sort((a, b) => b.weight - a.weight);

  return { percent, level: levelFor(percent), ranked };
}

/**
 * How many categories the result names.
 *
 * One when things are largely fine, three when they are not — the original's
 * rule, and a sensible one: somebody recovering does not need a list of four
 * things to work on, and somebody burnt out is rarely strained in only one
 * place.
 */
export function categoriesToShow(level: BurnoutLevel): number {
  return level === "low" ? 1 : level === "mid" ? 2 : 3;
}

/** Guards against a category being named with no wording behind it. */
export function hasCopyFor(category: BurnoutCategory): boolean {
  return Boolean(CATEGORIES[category] && PROFILES.low && PROFILES.mid && PROFILES.high);
}
