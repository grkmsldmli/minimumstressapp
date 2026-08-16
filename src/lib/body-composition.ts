/**
 * Body fat, and daily energy needs.
 *
 * Both formulas are carried over unchanged from the pages they replace: the
 * U.S. Navy circumference method, and Mifflin-St Jeor. They are the standard
 * ones, they were implemented correctly, and there is no reason to invent
 * anything — the work here is getting them out of a script tag and under test
 * so a typo in a coefficient cannot ship unnoticed.
 */

/* ------------------------------------------------------------------ */
/*  Body fat — U.S. Navy circumference method                          */
/* ------------------------------------------------------------------ */

export type Sex = "male" | "female";

export interface BodyFatInput {
  sex: Sex;
  /** Inches. */
  heightIn: number;
  waistIn: number;
  neckIn: number;
  /** Women only; the formula needs it and the male one does not. */
  hipIn?: number;
  weightKg: number;
}

export type FatBand = "essential" | "athletic" | "fitness" | "average" | "high";

export interface BodyFatResult {
  percent: number;
  band: FatBand;
  leanKg: number;
  fatKg: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The bands, which are different for men and women and not a matter of taste.
 *
 * Essential fat is the floor the body needs to make hormones with. It is at the
 * bottom of the scale but it is not the good end, which is the thing a bar
 * chart tends to imply and the copy has to say out loud.
 */
export function bandFor(percent: number, sex: Sex): FatBand {
  if (sex === "male") {
    if (percent <= 6) return "essential";
    if (percent <= 13) return "athletic";
    if (percent <= 17) return "fitness";
    if (percent <= 24) return "average";
    return "high";
  }

  if (percent <= 13) return "essential";
  if (percent <= 20) return "athletic";
  if (percent <= 24) return "fitness";
  if (percent <= 31) return "average";
  return "high";
}

export function bodyFatFor(input: BodyFatInput): BodyFatResult {
  const { sex, heightIn, waistIn, neckIn, hipIn = 0, weightKg } = input;

  const raw =
    sex === "male"
      ? 86.01 * Math.log10(waistIn - neckIn) - 70.041 * Math.log10(heightIn) + 36.76
      : 163.205 * Math.log10(waistIn + hipIn - neckIn) -
        97.684 * Math.log10(heightIn) -
        78.387;

  // Clamped because the logarithms run away at the edges: a mistyped neck
  // measurement can otherwise produce a negative percentage or one above 100,
  // and a number like that on a page about somebody's body is worse than a
  // refusal to answer.
  const percent = Math.max(3, Math.min(60, round1(raw)));

  return {
    percent,
    band: bandFor(percent, sex),
    leanKg: round1(weightKg * (1 - percent / 100)),
    fatKg: round1(weightKg * (percent / 100)),
  };
}

export const FAT_BAND_COPY: Record<FatBand, string> = {
  essential:
    "This is at or near the floor the body needs to make hormones, absorb vitamins and regulate temperature. Athletes reach it deliberately and briefly; held for long it tends to show up as poor sleep, low mood, and in women a disrupted cycle.",
  athletic:
    "A lean, athletic range. It is usually the result of consistent training and enough protein to hold muscle while doing it.",
  fitness:
    "A range most people can hold without their life revolving around it, which is what makes it worth aiming at rather than something leaner.",
  average:
    "The most common range. Where the fat sits matters more than the number — around the middle carries more risk than the same amount elsewhere.",
  high: "Above the usual range. Worth a conversation with a doctor who can look at blood pressure and blood sugar rather than a tape measure, since those are what actually decide the risk.",
};

/* ------------------------------------------------------------------ */
/*  Daily energy — Mifflin-St Jeor                                     */
/* ------------------------------------------------------------------ */

export type Activity = "sedentary" | "light" | "moderate" | "very" | "athlete";
export type Goal = "lose" | "maintain" | "gain";

export const ACTIVITY: Record<Activity, { multiplier: number; label: string }> = {
  sedentary: { multiplier: 1.2, label: "Desk job, little exercise" },
  light: { multiplier: 1.375, label: "Light exercise, 1–3 days a week" },
  moderate: { multiplier: 1.55, label: "Exercise 3–5 days a week" },
  very: { multiplier: 1.725, label: "Hard exercise 6–7 days a week" },
  athlete: { multiplier: 1.9, label: "Twice a day, or a physical job" },
};

export const GOAL_SHIFT: Record<Goal, number> = { lose: -500, maintain: 0, gain: 300 };

export interface EnergyResult {
  /** At rest. */
  bmr: number;
  /** With activity. */
  tdee: number;
  /** After the goal is applied. */
  target: number;
  macros: { proteinG: number; carbsG: number; fatG: number };
}

export function energyFor(input: {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
}): EnergyResult {
  const { sex, age, heightCm, weightKg, activity, goal } = input;

  const bmr = Math.round(
    10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161),
  );
  const tdee = Math.round(bmr * ACTIVITY[activity].multiplier);

  /*
   * A floor of 1200. The old page used 900, which is below what anybody should
   * be eating without supervision — and a calculator that prints it is giving
   * permission. Above the floor nothing changes; below it, the number stops
   * being advice.
   */
  const target = Math.max(1200, tdee + GOAL_SHIFT[goal]);

  // Protein per kilo and fat as a share of calories, both from the page this
  // replaces. Carbohydrate is whatever is left.
  const proteinPerKg = goal === "lose" ? 2.2 : goal === "gain" ? 2.0 : 1.8;
  const fatShare = goal === "lose" ? 0.25 : 0.3;

  const proteinG = Math.round(weightKg * proteinPerKg);
  const fatG = Math.round((target * fatShare) / 9);
  const carbsG = Math.max(0, Math.round((target - proteinG * 4 - fatG * 9) / 4));

  return { bmr, tdee, target, macros: { proteinG, carbsG, fatG } };
}
