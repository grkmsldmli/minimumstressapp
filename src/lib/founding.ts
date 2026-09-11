/**
 * Founding 100 — the marketplace's first hosts and first practitioners, named
 * for good.
 *
 * FOUNDING HOST is a permanent legacy status for the first hundred hosts to bring
 * a listing live in the Bay Area. FOUNDING PRACTITIONER is its mirror on the
 * other side: the first hundred practitioners to complete professional onboarding
 * — a vetted early professional (verified identity, insurance and credential,
 * with a name and chosen profession), not the first to run a transaction. The two
 * cohorts are independent: the hundredth host does not affect practitioner
 * capacity, nor the reverse.
 *
 * The status and its number are permanent recognition — never taken away. On top
 * of that recognition each cohort now also carries a Pro benefit (six months
 * free, then a lifetime 50% off the applicable Pro price): Founding Host → Studio
 * Pro, Founding Practitioner → practitioner Pro. Those economics live in
 * `lib/entitlements` + `lib/stripe/subscription`, DERIVED from the founding award
 * date, not here — this file holds only the cohort caps and the words around them.
 *
 * Each status, its number, and the count still available are the server's alone.
 * The allocation, the qualifying moment, and the atomic guarantee that a
 * hundred-and-first can never be granted live in migrations 0060 (host) and 0068
 * (practitioner), with the cap RAISED from 50 to 100 in 0071 via create-or-replace
 * (0060/0068 are frozen). The numbers here are pinned to the SQL caps by
 * founding-sql-sync.test, which reads the authoritative 0071 definitions.
 */

/** How many Founding Host spots exist, ever. Matches the 1..100 cap in 0071. */
export const FOUNDING_HOST_LIMIT = 100;

/** How many Founding Practitioner spots exist, ever. Matches the 1..100 cap in 0071. */
export const FOUNDING_PRACTITIONER_LIMIT = 100;

/** What a Founding Host's status is called, wherever it is shown. */
export const FOUNDING_HOST_LABEL = "Founding Host";

/** What a Founding Practitioner's status is called, wherever it is shown. */
export const FOUNDING_PRACTITIONER_LABEL = "Founding Practitioner";

/**
 * The "N spots remaining" line, for either cohort.
 *
 * Always the real number, straight from the server's `*_remaining()` function —
 * never a seeded or decorative countdown. Clamped to the cohort's cap, and
 * singular is handled so the last spot does not read "1 spots".
 */
function spotsRemainingLabel(remaining: number, limit: number, label: string): string {
  const n = Math.max(0, Math.min(limit, remaining));
  return `${n} ${label} ${n === 1 ? "spot" : "spots"} remaining`;
}

export function foundingSpotsRemainingLabel(remaining: number): string {
  return spotsRemainingLabel(remaining, FOUNDING_HOST_LIMIT, FOUNDING_HOST_LABEL);
}

export function foundingPractitionerSpotsRemainingLabel(remaining: number): string {
  return spotsRemainingLabel(remaining, FOUNDING_PRACTITIONER_LIMIT, FOUNDING_PRACTITIONER_LABEL);
}
