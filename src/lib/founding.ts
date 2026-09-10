/**
 * Founding 50 — the marketplace's first hosts and first practitioners, named
 * for good.
 *
 * FOUNDING HOST is a permanent legacy status for the first fifty hosts to bring
 * a listing live in the Bay Area. FOUNDING PRACTITIONER is its mirror on the
 * other side: the first fifty practitioners to complete professional onboarding
 * — a vetted early professional (verified identity, insurance and credential,
 * with a name and chosen profession), not the first to run a transaction.
 * Both are a distinction, not a deal — no fee change, no free period, nothing to
 * reconcile — recognition only, the same choice `lib/badges`, `lib/milestones`
 * and `lib/host-achievements` all make.
 *
 * Each status, its number, and the count still available are the server's alone.
 * This file holds only the caps and the words around them; the allocation, the
 * qualifying moment, and the atomic guarantee that a fifty-first can never be
 * granted live in migrations 0060 (host) and 0068 (practitioner) —
 * `award_founding_host`/`founding_hosts_remaining` and their practitioner twins.
 * The numbers here are pinned to the SQL caps by founding-sql-sync.test.
 */

/** How many Founding Host spots exist, ever. Matches the 1..50 cap in 0060. */
export const FOUNDING_HOST_LIMIT = 50;

/** How many Founding Practitioner spots exist, ever. Matches the 1..50 cap in 0068. */
export const FOUNDING_PRACTITIONER_LIMIT = 50;

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
