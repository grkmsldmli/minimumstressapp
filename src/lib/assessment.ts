/**
 * The engine every questionnaire on the site runs on.
 *
 * Three of them ask a person about their own week and score it, and they were
 * about to be written three times — which is how the Shopify set ended up with
 * a high score meaning "good" on one page and "bad" on the next, and with the
 * band-ceiling rule below present in none of them.
 *
 * So the rules live here once: options are written best-first, higher is
 * always better, and a strong average can never hide a collapsed dimension.
 * A questionnaire is then just its questions and its wording.
 */

export interface Question<D extends string> {
  id: string;
  dimension: D;
  text: string;
  /** Best first. Scored 3, 2, 1, 0 by position. */
  options: [string, string, string, string];
}

export interface DimensionCopy {
  label: string;
  meaning: string;
}

export type Band = "steady" | "carrying" | "low" | "depleted";

export interface Assessment<D extends string> {
  dimensions: Record<D, DimensionCopy>;
  questions: Question<D>[];
  band: Record<Band, { label: string; body: string }>;
  /** One concrete thing to do, per dimension. */
  firstStep: Record<D, string>;
}

/** Answers by question id, each the index of the option chosen. */
export type Answers = Record<string, number>;

export interface Result<D extends string> {
  /** 0–100, higher is better, the same direction on every tool here. */
  score: number;
  band: Band;
  dimensions: Record<D, number>;
  /** The thinnest one — where a change is worth the most. */
  weakest: D;
}

const PER_QUESTION_MAX = 3;
const BANDS: Band[] = ["depleted", "low", "carrying", "steady"];

function percent(points: number, questions: number): number {
  return Math.round((points / (questions * PER_QUESTION_MAX)) * 100);
}

export function bandFor(score: number): Band {
  if (score >= 75) return "steady";
  if (score >= 50) return "carrying";
  if (score >= 25) return "low";
  return "depleted";
}

/**
 * The headline band, held down by the worst dimension.
 *
 * A mean hides a collapse. Worst possible on one dimension of four and best on
 * the rest averages 75, and an average alone calls that "holding up" — to
 * somebody who has just described the opposite, which is exactly the person
 * who needs to hear otherwise.
 *
 * At most one step above the weakest dimension's own band. One step rather
 * than none: three strong areas are genuinely worth something, and pinning the
 * result to the single worst answer would make the other questions decorative.
 */
function bandWith(score: number, weakestScore: number): Band {
  const overall = BANDS.indexOf(bandFor(score));
  const ceiling = BANDS.indexOf(bandFor(weakestScore)) + 1;
  return BANDS[Math.min(overall, ceiling)];
}

export function isComplete<D extends string>(
  assessment: Assessment<D>,
  answers: Answers,
): boolean {
  return assessment.questions.every((question) => answers[question.id] !== undefined);
}

export function score<D extends string>(
  assessment: Assessment<D>,
  answers: Answers,
): Result<D> {
  const keys = Object.keys(assessment.dimensions) as D[];
  const points = Object.fromEntries(keys.map((k) => [k, 0])) as Record<D, number>;
  const counts = Object.fromEntries(keys.map((k) => [k, 0])) as Record<D, number>;

  for (const question of assessment.questions) {
    const chosen = answers[question.id];
    if (chosen === undefined) continue;
    // Options are written best-first, so the score is the distance from the
    // worst answer rather than the index itself.
    points[question.dimension] += PER_QUESTION_MAX - chosen;
    counts[question.dimension] += 1;
  }

  const dimensions = Object.fromEntries(
    keys.map((k) => [k, percent(points[k], counts[k] || 1)]),
  ) as Record<D, number>;

  const total = keys.reduce((sum, k) => sum + points[k], 0);
  const answered = keys.reduce((sum, k) => sum + counts[k], 0);
  const overall = percent(total, answered || 1);

  const weakest = keys.reduce((worst, next) =>
    dimensions[next] < dimensions[worst] ? next : worst,
  );

  return {
    score: overall,
    band: bandWith(overall, dimensions[weakest]),
    dimensions,
    weakest,
  };
}
