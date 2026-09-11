import type { BoardFilters } from "../domain";

/**
 * The board's only narrowing.
 *
 * This is the one thing that ever removes a listing from the browse, and it is a
 * plain AND of the filters the practitioner set — never a ranking, a score, or a
 * hidden exclusion. An absent filter matches everything. The caller never runs
 * it against a row the practitioner is already engaged with, so a filter can
 * hide a listing from the browse but never an application already in flight.
 *
 * Kept out of work-service (which is server-only) so it can be unit-tested and
 * so the rule that governs visibility lives in one small, readable place.
 */
export interface BoardRow {
  profession: string | null;
  session_format?: string | null;
  level?: string | null;
  pay_cents: number;
  urgent: boolean;
  starts_at: string;
}

export function passesFilters(row: BoardRow, f: BoardFilters): boolean {
  if (f.profession && row.profession !== f.profession) return false;
  if (f.sessionFormat && (row.session_format ?? null) !== f.sessionFormat) return false;
  if (f.level && (row.level ?? null) !== f.level) return false;
  if (f.urgentOnly && !row.urgent) return false;
  if (f.minPayCents != null && row.pay_cents < f.minPayCents) return false;
  const start = new Date(row.starts_at).getTime();
  if (f.onOrAfter && start < f.onOrAfter.getTime()) return false;
  if (f.onOrBefore && start > f.onOrBefore.getTime()) return false;
  return true;
}
