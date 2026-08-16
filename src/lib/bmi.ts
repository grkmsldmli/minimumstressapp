/**
 * BMI, and the healthy-weight range that follows from a height.
 *
 * Kept out of the component so the arithmetic can be checked without a
 * browser. The old page did this inline in a script tag, collected age and sex
 * on the form, and then never passed either into the calculation — two pieces
 * of personal information asked for and discarded. They are not here because
 * the formula does not use them.
 */

export type BmiBand = "under" | "healthy" | "over" | "obese";

export interface BmiResult {
  /** Rounded to one decimal, which is as precise as the inputs justify. */
  bmi: number;
  band: BmiBand;
  /** The weight range for this height at BMI 18.5–24.9, in kilograms. */
  healthyLowKg: number;
  healthyHighKg: number;
  /**
   * Kilograms between the current weight and the nearest edge of that range.
   * Zero inside it — the answer to "how far" when the answer is "you are there".
   */
  toRangeKg: number;
}

/** The band boundaries, as the WHO sets them. */
const HEALTHY_LOW = 18.5;
const HEALTHY_HIGH = 24.9;
const OBESE = 30;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function bandFor(bmi: number): BmiBand {
  if (bmi < HEALTHY_LOW) return "under";
  if (bmi < HEALTHY_HIGH + 0.1) return "healthy";
  if (bmi < OBESE) return "over";
  return "obese";
}

/**
 * @param heightCm centimetres
 * @param weightKg kilograms
 */
export function bmiFor(heightCm: number, weightKg: number): BmiResult {
  const metres = heightCm / 100;
  const bmi = round1(weightKg / (metres * metres));
  const healthyLowKg = round1(HEALTHY_LOW * metres * metres);
  const healthyHighKg = round1(HEALTHY_HIGH * metres * metres);

  const toRangeKg =
    weightKg < healthyLowKg
      ? round1(healthyLowKg - weightKg)
      : weightKg > healthyHighKg
        ? round1(weightKg - healthyHighKg)
        : 0;

  return { bmi, band: bandFor(bmi), healthyLowKg, healthyHighKg, toRangeKg };
}

/** Feet and inches to centimetres, for the imperial side of the form. */
export function heightFromImperial(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}

/** Pounds to kilograms. */
export function kilosFromPounds(pounds: number): number {
  return pounds * 0.453592;
}

/**
 * What the range is called, and what it is honest to say about it.
 *
 * Deliberately flat. The old copy told somebody over thirty that their body was
 * "under significant physiological load" and listed the diseases — on a page
 * that had measured two numbers and knew nothing else about them. A screening
 * ratio is not grounds for a prognosis, and frightening somebody is not the
 * same as informing them.
 */
export const BAND_COPY: Record<BmiBand, { label: string; body: string }> = {
  under: {
    label: "Below the healthy range",
    body: "A BMI under 18.5 is below the range associated with the best health outcomes at a population level. It can mean many things — a light frame, a recent illness, or not eating enough — and the number cannot tell which.",
  },
  healthy: {
    label: "Within the healthy range",
    body: "A BMI between 18.5 and 24.9 sits in the range associated with the best health outcomes at a population level. It says nothing about how much of your weight is muscle, or how you feel.",
  },
  over: {
    label: "Above the healthy range",
    body: "A BMI between 25 and 29.9 is above that range. For a lot of people this reflects body fat; for people carrying real muscle it does not, which is the main thing BMI gets wrong.",
  },
  obese: {
    label: "Well above the healthy range",
    body: "A BMI of 30 or more is well above that range. It is a screening threshold, not a diagnosis — what it is worth is a conversation with a doctor who can measure more than two numbers.",
  },
};
