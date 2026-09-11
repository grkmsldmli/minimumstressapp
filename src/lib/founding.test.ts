import { describe, expect, it } from "vitest";

import {
  FOUNDING_HOST_LABEL,
  FOUNDING_HOST_LIMIT,
  FOUNDING_PRACTITIONER_LABEL,
  FOUNDING_PRACTITIONER_LIMIT,
  foundingPractitionerSpotsRemainingLabel,
  foundingSpotsRemainingLabel,
} from "./founding";

describe("the cap", () => {
  it("is one hundred", () => {
    expect(FOUNDING_HOST_LIMIT).toBe(100);
  });

  it("names the status the way the brief does", () => {
    expect(FOUNDING_HOST_LABEL).toBe("Founding Host");
  });

  it("mirrors the same cap and naming on the practitioner side", () => {
    expect(FOUNDING_PRACTITIONER_LIMIT).toBe(100);
    expect(FOUNDING_PRACTITIONER_LABEL).toBe("Founding Practitioner");
  });
});

describe("the spots-remaining line", () => {
  it("shows the real number, plural for many", () => {
    expect(foundingSpotsRemainingLabel(17)).toBe("17 Founding Host spots remaining");
  });

  it("says spot, singular, for the last one", () => {
    expect(foundingSpotsRemainingLabel(1)).toBe("1 Founding Host spot remaining");
  });

  it("never reads below zero or above the cap, whatever it is handed", () => {
    expect(foundingSpotsRemainingLabel(-3)).toBe("0 Founding Host spots remaining");
    expect(foundingSpotsRemainingLabel(999)).toBe("100 Founding Host spots remaining");
  });

  it("reads the same way for practitioners, with their own label", () => {
    expect(foundingPractitionerSpotsRemainingLabel(17)).toBe(
      "17 Founding Practitioner spots remaining",
    );
    expect(foundingPractitionerSpotsRemainingLabel(1)).toBe(
      "1 Founding Practitioner spot remaining",
    );
    expect(foundingPractitionerSpotsRemainingLabel(-3)).toBe(
      "0 Founding Practitioner spots remaining",
    );
    expect(foundingPractitionerSpotsRemainingLabel(999)).toBe(
      "100 Founding Practitioner spots remaining",
    );
  });
});
