import {
  SLEEP_BANDS,
  SLEEP_DIMENSIONS,
  SLEEP_POOL,
  type SleepDimension,
  type SleepQuestion,
  type SleepType,
} from "./sleep-data";

export {
  SLEEP_BANDS,
  SLEEP_DIMENSIONS,
  SLEEP_POOL,
  type SleepDimension,
  type SleepQuestion,
  type SleepType,
} from "./sleep-data";

/**
 * Sleep Score, scored exactly as the original did.
 *
 * Twelve questions drawn from the pool. Each answer carries points across all
 * five dimensions at once, the dimensions are turned into percentages against
 * a fixed maximum of eighteen, and the overall score is their mean.
 *
 * One thing had to be fixed rather than carried over.
 *
 * The original divided every dimension by a fixed eighteen — six questions at
 * three points each. But only twelve questions are drawn, each scores exactly
 * one dimension, and twelve spread over five dimensions is about two and a
 * half each: seven points where the divisor expects eighteen. So the ceiling
 * was around forty, nobody could score above it, and answering every question
 * with the healthiest option returned 40 and the label "Exhausted Cyclist".
 * The tool told its best possible sleeper they were running a sleep debt.
 *
 * The divisor is now what the drawn questions could actually have given, which
 * is how the gut, inflammation and cortisol assessments already worked. The
 * eighteen presumably fitted an earlier version with six questions a
 * dimension, and stopped fitting when the draw changed.
 *
 * The type chain is untouched. It ends in `else`, so anything under seventy
 * matching neither named pattern lands on "Sleep Dysregulated" — the worst of
 * the four. That is theirs, and the tests pin it rather than pretend it is not
 * there.
 */

export const DRAWN = 12;

export interface SleepResult {
  /** 0–100, higher is better. */
  overall: number;
  type: SleepType;
  dimensions: Record<SleepDimension, number>;
}

const KEYS: SleepDimension[] = ["A", "C", "Q", "R", "D"];

function defaultShuffle(items: SleepQuestion[]): SleepQuestion[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function drawSleepQuestions(
  pool: SleepQuestion[] = SLEEP_POOL,
  shuffle: (items: SleepQuestion[]) => SleepQuestion[] = defaultShuffle,
): SleepQuestion[] {
  return shuffle(pool).slice(0, DRAWN);
}

/**
 * Their chain, unchanged.
 *
 * Seventy and above is a deep restorer. Below that it looks for two specific
 * shapes, and everything else falls through to the worst label.
 */
export function typeFor(
  overall: number,
  dimensions: Record<SleepDimension, number>,
): SleepType {
  if (overall >= 70) return "deep";
  if (dimensions.Q < 40 && dimensions.A < 40) return "light";
  if (dimensions.C < 40 && dimensions.D < 40) return "cyclist";
  return "dysregulated";
}

export function scoreSleep(
  questions: SleepQuestion[],
  answers: Record<number, number>,
): SleepResult {
  const totals: Record<SleepDimension, number> = { A: 0, C: 0, Q: 0, R: 0, D: 0 };
  const maximums: Record<SleepDimension, number> = { A: 0, C: 0, Q: 0, R: 0, D: 0 };

  questions.forEach((question, index) => {
    const chosen = answers[index];
    if (chosen === undefined) return;
    const points = question.scores[chosen];
    for (const key of KEYS) {
      totals[key] += points[key];
      // What this question could have contributed, which is what the score is
      // out of. See the note below on why it is not a fixed number.
      maximums[key] += Math.max(...question.scores.map((score) => score[key]));
    }
  });

  const dimensions = Object.fromEntries(
    KEYS.map((key) => [
      key,
      maximums[key] > 0 ? Math.round((totals[key] / maximums[key]) * 100) : 0,
    ]),
  ) as Record<SleepDimension, number>;

  /*
   * The mean is taken over the dimensions that were actually asked about.
   *
   * Twelve are drawn from thirty-one, and only four of those thirty-one score
   * sleep quality — so a draw can easily contain none of them. Averaging over
   * all five regardless scores that dimension zero and drags the total down by
   * twenty points, marking somebody down for a question they were never asked.
   * It is the same rule the other assessments use for a half-finished set:
   * what was not asked is not counted against you.
   */
  const asked = KEYS.filter((key) => maximums[key] > 0);
  const overall =
    asked.length > 0
      ? Math.round(asked.reduce((sum, key) => sum + dimensions[key], 0) / asked.length)
      : 0;

  return { overall, type: typeFor(overall, dimensions), dimensions };
}

export function isSleepComplete(
  questions: SleepQuestion[],
  answers: Record<number, number>,
): boolean {
  return questions.every((_, index) => answers[index] !== undefined);
}

export function hasBandCopy(type: SleepType): boolean {
  return Boolean(SLEEP_BANDS[type]?.title && SLEEP_BANDS[type]?.desc);
}

export function dimensionLabel(key: SleepDimension): string {
  return SLEEP_DIMENSIONS[key];
}
