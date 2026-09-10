import { describe, expect, it } from "vitest";

import {
  PRACTITIONER_PROFESSIONS,
  PROFESSION_KEYS,
  isKnownProfession,
  professionFor,
  professionLabel,
  proofFor,
  requiresCredential,
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

describe("professional proof", () => {
  it("requires proof from every profession", () => {
    for (const p of PRACTITIONER_PROFESSIONS) {
      expect(requiresCredential(p.key), p.key).toBe(true);
      expect(p.proof.required, p.key).toBe(true);
      expect(p.proof.label.length, p.key).toBeGreaterThan(3);
    }
  });

  it("asks massage for CAMTC specifically", () => {
    expect(proofFor("massage").kind).toBe("camtc");
    expect(proofFor("massage").label).toBe("CAMTC certification");
  });

  it("asks movement-and-teaching professions for a training certificate", () => {
    for (const key of ["pilates", "yoga", "movement", "meditation", "holistic"]) {
      expect(proofFor(key).kind, key).toBe("training");
    }
  });

  it("asks coaching and the generic professional for reasonable professional proof", () => {
    for (const key of ["coaching", "other"]) {
      expect(proofFor(key).kind, key).toBe("professional");
    }
  });

  it("still requires proof — generic — when no profession is set", () => {
    expect(requiresCredential(null)).toBe(true);
    expect(requiresCredential(undefined)).toBe(true);
    expect(requiresCredential("astronaut")).toBe(true);
    expect(proofFor(null).kind).toBe("professional");
  });
});
