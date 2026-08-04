import type { AddressSuggestion } from "./geo";

/**
 * Making a typed address searchable, and putting the useful answers first.
 *
 * Pure, because both halves were arrived at by measuring real provider
 * responses and the measurements are worth keeping as tests rather than as a
 * memory of an afternoon.
 */

/**
 * US street abbreviations, expanded before the query is sent.
 *
 * This is not cosmetic. Measured against the live geocoder, "1301 w hillsdale
 * blv" returned an alley in Sacramento and "1301 w hillsdale blvd san mateo"
 * returned nothing at all, while the same address with the words spelled out
 * found the right street in the right city. People type the short forms — the
 * expansion is what makes the field usable.
 */
const ABBREVIATIONS: Record<string, string> = {
  // Street types
  st: "Street",
  str: "Street",
  ave: "Avenue",
  av: "Avenue",
  blvd: "Boulevard",
  blv: "Boulevard",
  rd: "Road",
  dr: "Drive",
  ln: "Lane",
  ct: "Court",
  pl: "Place",
  plz: "Plaza",
  pkwy: "Parkway",
  pky: "Parkway",
  hwy: "Highway",
  ter: "Terrace",
  trl: "Trail",
  cir: "Circle",
  sq: "Square",
  expy: "Expressway",

  // Directionals
  n: "North",
  s: "South",
  e: "East",
  w: "West",
  ne: "Northeast",
  nw: "Northwest",
  se: "Southeast",
  sw: "Southwest",
};

/**
 * Unit designators, dropped rather than expanded.
 *
 * "Suite 200" is not part of what a geocoder can find — no map has a point for
 * it — and leaving it in pushes the query away from the building that does
 * exist. The host still types it; it just does not go to the provider.
 *
 * A following number is required, and that requirement is the whole safety of
 * this. "Ste" is both an abbreviation for Suite and the French for Sainte, so
 * matching the word alone deleted the place name in "4 Ste Genevieve Road" and
 * searched for "4 Road". Nobody types a unit without its number, so demanding
 * one costs nothing and keeps every saint on the map.
 */
const UNIT_MARKERS = /\b(?:suite|ste|apt|apartment|unit|fl|floor|rm|room)\.?\s*#?\s*\d[\w-]*/gi;

/** The bare "#200" form, which has no word to anchor to. */
const HASH_UNIT = /#\s*\d[\w-]*/g;

export function normalizeQuery(raw: string): string {
  const withoutUnits = raw.replace(UNIT_MARKERS, " ").replace(HASH_UNIT, " ");

  const expanded = withoutUnits
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      // Only bare words are abbreviations. "W." is; "W12" and "4th" are not.
      const bare = token.replace(/[.,]+$/, "");
      if (!/^[A-Za-z]+$/.test(bare)) return token;
      return ABBREVIATIONS[bare.toLowerCase()] ?? token;
    })
    .join(" ");

  return expanded.replace(/\s+/g, " ").trim();
}

/** The house number a query opens with, if it opens with one. */
export function leadingHouseNumber(raw: string): string | null {
  const match = raw.trim().match(/^(\d+[A-Za-z]?)\b/);
  return match ? match[1] : null;
}

/**
 * Orders results by how well they answer what was actually asked.
 *
 * Providers rank by their own relevance, which for OSM-derived data means a
 * street called "Hillsdale Blvd Walerga Road Alley" can outrank the building
 * someone typed the number of. When a query starts with a house number, a
 * result carrying that exact number is the answer and everything else is a
 * guess — so exact matches lead, other numbered addresses follow, and bare
 * streets come last.
 */
export function rankSuggestions(
  suggestions: AddressSuggestion[],
  query: string,
): AddressSuggestion[] {
  const wanted = leadingHouseNumber(query);

  // No number typed, no opinion. Someone searching for a street wants the
  // street, and promoting arbitrary buildings on it buries what they asked for.
  if (!wanted) return suggestions;

  const score = (suggestion: AddressSuggestion): number => {
    const number = leadingHouseNumber(suggestion.primary);

    if (number === wanted) return 0;
    if (number) return 1;
    return 2;
  };

  // Stable: equal scores keep the provider's own ordering, which is better
  // than ours at everything except this one question.
  return suggestions
    .map((suggestion, index) => ({ suggestion, index, score: score(suggestion) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.suggestion);
}
