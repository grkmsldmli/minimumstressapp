import { describe, expect, it } from "vitest";

import type { AddressSuggestion } from "./geo";
import { leadingHouseNumber, normalizeQuery, rankSuggestions } from "./geocode-query";

/**
 * Both of these were arrived at by measuring what a live geocoder does with
 * what people actually type. The cases are those measurements, kept.
 */

describe("normalizeQuery", () => {
  /**
   * The measurement that started it: "1301 w hillsdale blv" found an alley in
   * Sacramento, and the spelled-out form found the right street in San Mateo.
   */
  it("expands the abbreviations people type", () => {
    expect(normalizeQuery("1301 w hillsdale blv")).toBe("1301 West hillsdale Boulevard");
    expect(normalizeQuery("450 sutter st")).toBe("450 sutter Street");
    expect(normalizeQuery("2200 e cesar chavez st")).toBe("2200 East cesar chavez Street");
  });

  it("handles the trailing full stop people type after an abbreviation", () => {
    expect(normalizeQuery("12 N. Alder Ave.")).toBe("12 North Alder Avenue");
  });

  /** Only bare words are abbreviations. Numbers that merely start with one are not. */
  it.each([
    ["350 5th Ave", "350 5th Avenue"],
    ["1 W12 Street", "1 W12 Street"],
  ])("leaves %s alone where it should", (input, expected) => {
    expect(normalizeQuery(input)).toBe(expected);
  });

  /**
   * "Ste" is both an abbreviation for Suite and the French for Sainte. Treating
   * the word alone as a unit marker deleted the place name here and searched
   * for "4 Road" — so a unit only counts when a number follows it.
   */
  it("keeps a saint that looks like a suite", () => {
    expect(normalizeQuery("4 Ste Genevieve Road")).toBe("4 Ste Genevieve Road");
  });

  /**
   * A geocoder has no point for "Suite 200" — leaving it in pushes the query
   * away from the building that does exist.
   */
  it.each([
    "1301 West Hillsdale Boulevard Suite 200",
    "1301 West Hillsdale Boulevard, Ste 200",
    "1301 West Hillsdale Boulevard #200",
    "1301 West Hillsdale Boulevard Apt 200",
  ])("drops the unit from %s", (input) => {
    expect(normalizeQuery(input)).toMatch(/^1301 West Hillsdale Boulevard,?$/);
  });

  it("collapses the whitespace it creates", () => {
    expect(normalizeQuery("  1301   w    hillsdale  ")).toBe("1301 West hillsdale");
  });

  it("leaves an address that needs nothing untouched", () => {
    expect(normalizeQuery("1 Infinite Loop Cupertino")).toBe("1 Infinite Loop Cupertino");
  });
});

describe("leadingHouseNumber", () => {
  it.each([
    ["1301 West Hillsdale", "1301"],
    ["12b Alder Lane", "12b"],
    ["  450 Sutter Street", "450"],
    ["West Hillsdale Boulevard", null],
    ["", null],
  ])("reads %s", (input, expected) => {
    expect(leadingHouseNumber(input)).toBe(expected);
  });
});

describe("rankSuggestions", () => {
  const make = (primary: string): AddressSuggestion => ({
    id: primary,
    primary,
    secondary: "San Mateo, California",
    addressLine: `${primary}, San Mateo`,
    lat: 37.5,
    lng: -122.3,
  });

  /**
   * The failure this exists for. The provider put a street called "Hillsdale
   * Blvd Walerga Road Alley" above the building whose number was typed.
   */
  it("puts the exact house number first", () => {
    const ranked = rankSuggestions(
      [make("Hillsdale Blvd Walerga Road Alley"), make("1700 West Hillsdale Boulevard"), make("1301 West Hillsdale Boulevard")],
      "1301 w hillsdale blvd",
    );

    expect(ranked[0].primary).toBe("1301 West Hillsdale Boulevard");
  });

  /**
   * The false positive that ranking on the number alone produced: identical
   * digits, entirely different place.
   */
  it("does not promote a matching number on a street nobody asked for", () => {
    const ranked = rankSuggestions(
      [make("1301 Summit Boulevard"), make("West Hillsdale Boulevard")],
      "1301 w hillsdale blv",
    );

    expect(ranked[0].primary).toBe("West Hillsdale Boulevard");
  });

  it("still puts the right street with the right number above everything", () => {
    const ranked = rankSuggestions(
      [make("1301 Summit Boulevard"), make("West Hillsdale Boulevard"), make("1301 West Hillsdale Boulevard")],
      "1301 w hillsdale blv",
    );

    expect(ranked.map((s) => s.primary)).toEqual([
      "1301 West Hillsdale Boulevard",
      "West Hillsdale Boulevard",
      "1301 Summit Boulevard",
    ]);
  });

  it("prefers any numbered address over a bare street", () => {
    const ranked = rankSuggestions(
      [make("West Hillsdale Boulevard"), make("1700 West Hillsdale Boulevard")],
      "1301 w hillsdale blvd",
    );

    expect(ranked[0].primary).toBe("1700 West Hillsdale Boulevard");
  });

  /**
   * Stable, because the provider is better than we are at every question
   * except this one — reordering results it already got right loses ground.
   */
  it("keeps the provider's order among equals", () => {
    const input = [make("First Street"), make("Second Street"), make("Third Street")];
    expect(rankSuggestions(input, "hillsdale").map((s) => s.primary)).toEqual([
      "First Street",
      "Second Street",
      "Third Street",
    ]);
  });

  it("changes nothing when no house number was typed", () => {
    const input = [make("West Hillsdale Boulevard"), make("1700 West Hillsdale Boulevard")];
    expect(rankSuggestions(input, "hillsdale boulevard").map((s) => s.primary)).toEqual([
      "West Hillsdale Boulevard",
      "1700 West Hillsdale Boulevard",
    ]);
  });
});
