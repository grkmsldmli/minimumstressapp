import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FOUNDING_HOST_LIMIT, FOUNDING_PRACTITIONER_LIMIT } from "./founding";

/**
 * The caps live in two places — the TS constant and the SQL migration — and a
 * silent drift between them is exactly the failure this pins shut. founding.ts's
 * own comment long claimed a "founding-sql-sync.test"; this is it, and it now
 * covers both cohorts.
 *
 * The AUTHORITATIVE cap now lives in 0071, which raised both cohorts from 50 to
 * 100 by create-or-replace-ing the award/remaining functions and swapping the
 * range/ceiling constraints. 0060 and 0068 are frozen historical migrations that
 * still read 50 — so this test reads the cap from 0071 (which each cohort's four
 * cap literals appear in) and separately pins 0060/0068 to their frozen 50, so a
 * future edit to either the constant or 0071 can never drift without a red test.
 *
 * Only the founding-specific cap shapes are read, so the session-milestone
 * buckets in 0060 (n >= 1000, 500, …) are never mistaken for a founding cap:
 *   - `between 1 and N`   the profiles range check and the ledger PK check
 *   - `taken >= N`        the allocation ceiling
 *   - `greatest(0, N -`   the remaining() function
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

function foundingCaps(sql: string): number[] {
  const nums: number[] = [];
  for (const re of [/between 1 and (\d+)/g, /taken >= (\d+)/g, /greatest\(0, (\d+) -/g]) {
    for (const m of sql.matchAll(re)) nums.push(Number(m[1]));
  }
  return nums;
}

describe("founding caps stay in sync between the TS constants and the SQL", () => {
  it("0071 is the authoritative cap and equals both TS constants (100)", () => {
    const caps = foundingCaps(read("../../supabase/migrations/0071_founding_100_and_practitioner_pro.sql"));
    // Per cohort: 2 range/PK checks + 1 allocation ceiling + 1 remaining() = 4,
    // and 0071 carries both cohorts, so at least 8 cap literals — all 100.
    expect(caps.length).toBeGreaterThanOrEqual(8);
    for (const n of caps) expect(n).toBe(100);
    expect(FOUNDING_HOST_LIMIT).toBe(100);
    expect(FOUNDING_PRACTITIONER_LIMIT).toBe(100);
  });

  it("the frozen 0060/0068 originals still read 50 (never edited)", () => {
    for (const n of foundingCaps(read("../../supabase/migrations/0060_founding_host.sql"))) {
      expect(n).toBe(50);
    }
    for (const n of foundingCaps(read("../../supabase/migrations/0068_founding_practitioner.sql"))) {
      expect(n).toBe(50);
    }
  });
});
