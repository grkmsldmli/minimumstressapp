/**
 * Which professional can cover which class, on the one axis both sides share.
 *
 * A coverage request names the `profession` it needs (from lib/professions); a
 * practitioner has one `profession`. An exact match always covers. Beyond that,
 * only the movement disciplines overlap, and only where it is genuinely true: a
 * movement coach is a generalist who can take a pilates or yoga slot, and a
 * pilates or yoga teacher can take a general movement slot. Everything licensed
 * or specialised — massage (CAMTC), holistic, meditation, coaching — is
 * exact-only, because a near-miss there is the wrong person in the room.
 *
 * A request with no profession means "any professional", so it covers everyone.
 * Kept tiny and controlled, pinned to lib/professions by a sync test, so the map
 * cannot name a profession that no longer exists.
 */

import { isKnownProfession } from "../professions";

/**
 * profession-needed → the OTHER professions that may also cover it. The exact
 * match is implicit and not repeated here.
 */
export const COVERAGE_ADJACENCY: Record<string, readonly string[]> = {
  movement: ["pilates", "yoga"],
  pilates: ["movement"],
  yoga: ["movement"],
};

/**
 * Can a practitioner of `practitioner` cover a class needing `requested`?
 *
 * - `requested` null/absent → any professional covers it.
 * - `practitioner` null → covers nothing specific.
 * - exact match → yes; otherwise only an adjacency entry.
 */
export function professionCovers(
  requested: string | null | undefined,
  practitioner: string | null | undefined,
): boolean {
  if (!requested) return true;
  if (!practitioner) return false;
  if (requested === practitioner) return true;
  return (COVERAGE_ADJACENCY[requested] ?? []).includes(practitioner);
}

/** True when every key and value in the adjacency map is a real profession. */
export function adjacencyIsKnown(): boolean {
  for (const [key, values] of Object.entries(COVERAGE_ADJACENCY)) {
    if (!isKnownProfession(key)) return false;
    if (!values.every(isKnownProfession)) return false;
  }
  return true;
}
