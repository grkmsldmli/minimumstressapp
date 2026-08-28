import { describe, expect, it } from "vitest";

import { FOUNDING_HOST_LIMIT, FOUNDING_HOST_LABEL, foundingSpotsRemainingLabel } from "./founding";

describe("the cap", () => {
  it("is fifty", () => {
    expect(FOUNDING_HOST_LIMIT).toBe(50);
  });

  it("names the status the way the brief does", () => {
    expect(FOUNDING_HOST_LABEL).toBe("Founding Host");
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
    expect(foundingSpotsRemainingLabel(999)).toBe("50 Founding Host spots remaining");
  });
});
