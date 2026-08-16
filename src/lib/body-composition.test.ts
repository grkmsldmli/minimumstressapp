import { describe, expect, it } from "vitest";

import { bandFor, bodyFatFor, energyFor } from "./body-composition";

/**
 * Both formulas are published and were implemented correctly on the pages this
 * replaces. What is being pinned here is that they stayed that way through the
 * move — a transposed coefficient in a logarithm produces a plausible-looking
 * number rather than an obvious error, which is exactly the kind that ships.
 */

describe("body fat, U.S. Navy method", () => {
  /*
   * A worked example: 5'9" man, 34" waist, 15" neck.
   *   86.010 * log10(19) - 70.041 * log10(69) + 36.76 = 17.9508
   */
  it("matches the published formula for men", () => {
    const result = bodyFatFor({
      sex: "male",
      heightIn: 69,
      waistIn: 34,
      neckIn: 15,
      weightKg: 80,
    });
    expect(result.percent).toBe(18);
  });

  /*
   * 5'5" woman, 30" waist, 13" neck, 40" hips.
   *   163.205 * log10(57) - 97.684 * log10(65) - 78.387 = 31.0879
   */
  it("matches the published formula for women", () => {
    const result = bodyFatFor({
      sex: "female",
      heightIn: 65,
      waistIn: 30,
      neckIn: 13,
      hipIn: 40,
      weightKg: 65,
    });
    expect(result.percent).toBe(31.1);
  });

  it("splits weight into lean and fat mass", () => {
    const result = bodyFatFor({
      sex: "male",
      heightIn: 69,
      waistIn: 34,
      neckIn: 15,
      weightKg: 80,
    });
    expect(result.leanKg + result.fatKg).toBeCloseTo(80, 0);
  });

  /*
   * The logarithms run away at the edges. A mistyped neck measurement can
   * produce a negative percentage or one over a hundred, and a number like
   * that on a page about somebody's body is worse than refusing to answer.
   */
  it("clamps a nonsense measurement instead of printing nonsense", () => {
    const absurd = bodyFatFor({
      sex: "male",
      heightIn: 69,
      waistIn: 60,
      neckIn: 12,
      weightKg: 80,
    });
    expect(absurd.percent).toBeLessThanOrEqual(60);
    expect(absurd.percent).toBeGreaterThanOrEqual(3);
  });

  it("uses different bands for men and women", () => {
    // 22% is average for a man and athletic for a woman. Same number, two
    // different answers, which is the whole reason sex is asked for here.
    expect(bandFor(22, "male")).toBe("average");
    expect(bandFor(22, "female")).toBe("fitness");
  });

  it("names the floor as a floor", () => {
    expect(bandFor(5, "male")).toBe("essential");
    expect(bandFor(12, "female")).toBe("essential");
  });
});

describe("daily energy, Mifflin-St Jeor", () => {
  /* 80kg, 180cm, 30yo man: 10*80 + 6.25*180 - 5*30 + 5 = 1780. */
  it("computes BMR for men", () => {
    const result = energyFor({
      sex: "male",
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: "sedentary",
      goal: "maintain",
    });
    expect(result.bmr).toBe(1780);
  });

  /* 65kg, 165cm, 30yo woman: 10*65 + 6.25*165 - 5*30 - 161 = 1370.25 → 1370. */
  it("computes BMR for women", () => {
    const result = energyFor({
      sex: "female",
      age: 30,
      heightCm: 165,
      weightKg: 65,
      activity: "sedentary",
      goal: "maintain",
    });
    expect(result.bmr).toBe(1370);
  });

  it("applies the activity multiplier", () => {
    const result = energyFor({
      sex: "male",
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: "moderate",
      goal: "maintain",
    });
    expect(result.tdee).toBe(Math.round(1780 * 1.55));
  });

  it("shifts the target by the goal", () => {
    const base = { sex: "male" as const, age: 30, heightCm: 180, weightKg: 80, activity: "moderate" as const };
    const maintain = energyFor({ ...base, goal: "maintain" });
    expect(energyFor({ ...base, goal: "lose" }).target).toBe(maintain.target - 500);
    expect(energyFor({ ...base, goal: "gain" }).target).toBe(maintain.target + 300);
  });

  /*
   * The old page floored this at 900, which is below what anybody should be
   * eating unsupervised — and a calculator that prints a number is giving
   * permission for it. A small woman cutting can otherwise be handed a figure
   * she should not be following.
   */
  it("will not recommend fewer than 1200 calories", () => {
    const result = energyFor({
      sex: "female",
      age: 60,
      heightCm: 150,
      weightKg: 45,
      activity: "sedentary",
      goal: "lose",
    });
    expect(result.target).toBe(1200);
  });

  it("splits the target into macros that add back up", () => {
    const result = energyFor({
      sex: "male",
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: "moderate",
      goal: "maintain",
    });
    const { proteinG, carbsG, fatG } = result.macros;
    const calories = proteinG * 4 + carbsG * 4 + fatG * 9;
    expect(Math.abs(calories - result.target)).toBeLessThan(15);
  });

  it("never returns negative carbohydrate", () => {
    // High protein target against a floored calorie target is where this
    // arithmetic goes below zero if nothing guards it.
    const result = energyFor({
      sex: "female",
      age: 60,
      heightCm: 150,
      weightKg: 90,
      activity: "sedentary",
      goal: "lose",
    });
    expect(result.macros.carbsG).toBeGreaterThanOrEqual(0);
  });
});
