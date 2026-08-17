import {
  type BurnoutCategory,
  type BurnoutLevel,
  type BurnoutQuestion,
  CATEGORIES,
  PROFILES,
  QUESTION_POOL,
} from "./burnout-data";

/**
 * `CATEGORIES` is deliberately not re-exported.
 *
 * It is the consultant directory the original ended each result with — a
 * label, a paragraph saying which kind of practitioner could help, and a list
 * of job titles to book. There are no consultants and no sessions now, so that
 * paragraph advertises something a reader cannot buy, which is worse than
 * saying nothing because it sits where advice should be.
 *
 * It stays in the data file because scoring still uses its keys, and because
 * deleting somebody else's extracted copy is not the same as not showing it.
 * Not exporting it from here is what keeps it off the page: an import that
 * would put it back in front of a reader now has to be written on purpose.
 * What replaces it is `BURNOUT_FOCUS` in ./focus.
 */
export {
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
  /**
   * Category totals, heaviest first.
   *
   * `weight` is the raw points, which is what the original ranked on and what
   * the ordering still uses. `percent` is those points against what the drawn
   * questions could have given that category — needed because the raw weights
   * are not comparable to each other: a draw might tag six questions
   * `physical` and one `spiritual`, and the larger number then says more about
   * the draw than about the person.
   */
  ranked: { category: BurnoutCategory; weight: number; percent: number }[];
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

  /** What each category could have scored, given the ten that were drawn. */
  const maximums: Record<BurnoutCategory, number> = {
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
    for (const tag of question.tags) {
      weights[tag] += points;
      maximums[tag] += MAX_PER_QUESTION;
    }
  });

  const percent = Math.round((total / (answered * MAX_PER_QUESTION || 1)) * 100);

  const ranked = (Object.keys(weights) as BurnoutCategory[])
    .map((category) => ({
      category,
      weight: weights[category],
      // Zero where the draw asked nothing about this category, which is not
      // the same as scoring nothing on it — see `categoriesToShow`, which is
      // why only the top one or three are ever named.
      percent:
        maximums[category] > 0 ? Math.round((weights[category] / maximums[category]) * 100) : 0,
    }))
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
