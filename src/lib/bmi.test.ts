import { describe, expect, it } from "vitest";

import { bandFor, bmiFor, heightFromImperial, kilosFromPounds } from "./bmi";

describe("bmiFor", () => {
  it("computes the ratio", () => {
    // 70kg at 1.75m is the worked example in every textbook: 22.9.
    expect(bmiFor(175, 70).bmi).toBe(22.9);
  });

  it("gives the healthy weight range for the height", () => {
    const result = bmiFor(175, 70);
    expect(result.healthyLowKg).toBe(56.7);
    expect(result.healthyHighKg).toBe(76.3);
  });

  it("is zero distance from the range when already inside it", () => {
    expect(bmiFor(175, 70).toRangeKg).toBe(0);
  });

  it("measures to the nearer edge, in both directions", () => {
    // 50kg at 1.75m: 6.7 short of 56.7.
    expect(bmiFor(175, 50).toRangeKg).toBe(6.7);
    // 90kg at 1.75m: 13.7 over 76.3.
    expect(bmiFor(175, 90).toRangeKg).toBe(13.7);
  });
});

describe("bandFor", () => {
  it("names each band", () => {
    expect(bandFor(17)).toBe("under");
    expect(bandFor(22)).toBe("healthy");
    expect(bandFor(27)).toBe("over");
    expect(bandFor(33)).toBe("obese");
  });

  /*
   * The published range is 18.5–24.9 inclusive, so 24.9 is healthy and 25.0 is
   * not. Written as `< 25` this is right; written as `< 24.9` it silently moves
   * everybody at exactly 24.9 into the band above and tells them the wrong
   * thing about their own body.
   */
  it("holds at the edges the WHO actually publishes", () => {
    expect(bandFor(18.4)).toBe("under");
    expect(bandFor(18.5)).toBe("healthy");
    expect(bandFor(24.9)).toBe("healthy");
    expect(bandFor(25)).toBe("over");
    expect(bandFor(29.9)).toBe("over");
    expect(bandFor(30)).toBe("obese");
  });
});

describe("unit conversion", () => {
  it("turns feet and inches into centimetres", () => {
    expect(Math.round(heightFromImperial(5, 9))).toBe(175);
    expect(Math.round(heightFromImperial(6, 0))).toBe(183);
  });

  it("turns pounds into kilograms", () => {
    expect(Math.round(kilosFromPounds(154))).toBe(70);
  });

  /** 5'9" and 154lb is the same person as 175cm and 70kg, so the BMI matches. */
  it("agrees with itself across units", () => {
    const metric = bmiFor(175, 70).bmi;
    const imperial = bmiFor(heightFromImperial(5, 9), kilosFromPounds(154)).bmi;
    expect(Math.abs(metric - imperial)).toBeLessThan(0.2);
  });
});
