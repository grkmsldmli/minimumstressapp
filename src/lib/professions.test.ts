import { describe, expect, it } from "vitest";

import {
  PRACTITIONER_PROFESSIONS,
  PROFESSION_KEYS,
  isKnownProfession,
  professionFor,
  professionLabel,
} from "./professions";

describe("practitioner professions", () => {
  it("has unique keys and a natural label on each", () => {
    const keys = PRACTITIONER_PROFESSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PRACTITIONER_PROFESSIONS) {
      expect(p.label.length, p.key).toBeGreaterThan(3);
      // Never a quality claim — the whole point of the feature.
      expect(p.label.toLowerCase()).not.toContain("certified");
    }
  });

  it("resolves a known key and refuses one that is not ours", () => {
    expect(professionLabel("pilates")).toBe("Pilates Instructor");
    expect(professionFor("nope")).toBeNull();
    expect(professionLabel("nope")).toBeNull();
    expect(professionLabel(null)).toBeNull();
    expect(professionLabel(undefined)).toBeNull();
  });

  it("guards writes with isKnownProfession", () => {
    expect(isKnownProfession("yoga")).toBe(true);
    expect(isKnownProfession("massage")).toBe(true);
    expect(isKnownProfession("astronaut")).toBe(false);
    expect(isKnownProfession("")).toBe(false);
  });

  it("exposes exactly the keys the DB check constraint allows (migration 0057)", () => {
    // The migration hard-codes this set; keeping them in step here means a new
    // profession cannot ship in code without the constraint being widened too.
    expect([...PROFESSION_KEYS].sort()).toEqual(
      [
        "coaching",
        "holistic",
        "massage",
        "meditation",
        "movement",
        "other",
        "pilates",
        "yoga",
      ].sort(),
    );
  });

  it("does not offer a therapy/counseling category in V1 (no implied credential)", () => {
    // "Massage Therapist" stays — the removed one is the mental-health category.
    expect(PROFESSION_KEYS).not.toContain("therapy");
    for (const p of PRACTITIONER_PROFESSIONS) {
      expect(p.label).not.toBe("Therapist or Counselor");
      expect(p.label.toLowerCase()).not.toContain("counselor");
    }
  });
});
