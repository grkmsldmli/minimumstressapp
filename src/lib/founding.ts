/**
 * Founding 50 — the marketplace's first hosts, named for good.
 *
 * FOUNDING HOST is a permanent legacy status for the first fifty hosts to bring
 * a listing live in the Bay Area. It is a distinction, not a deal: no fee
 * change, no free period, nothing to reconcile — recognition, the same choice
 * `lib/badges`, `lib/milestones` and `lib/host-achievements` all make.
 *
 * The status, its number, and the count still available are the server's alone.
 * This file holds only the cap and the words around it; the allocation, the
 * "earned when the first listing goes live", and the atomic guarantee that a
 * fifty-first can never be granted all live in migration 0060 —
 * `award_founding_host` and `founding_hosts_remaining`. The number here is
 * pinned to the SQL cap by founding-sql-sync.test.
 */

/** How many Founding Host spots exist, ever. Matches the 1..50 cap in 0060. */
export const FOUNDING_HOST_LIMIT = 50;

/** What a Founding Host's status is called, wherever it is shown. */
export const FOUNDING_HOST_LABEL = "Founding Host";

/**
 * The line shown to a host who has not earned it while spots remain.
 *
 * Always the real number, straight from `founding_hosts_remaining()` — never a
 * seeded or decorative countdown. Singular is handled so the last spot does not
 * read "1 spots".
 */
export function foundingSpotsRemainingLabel(remaining: number): string {
  const n = Math.max(0, Math.min(FOUNDING_HOST_LIMIT, remaining));
  return `${n} Founding Host ${n === 1 ? "spot" : "spots"} remaining`;
}
