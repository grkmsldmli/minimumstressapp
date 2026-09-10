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
  it("host: every cap literal in 0060 equals FOUNDING_HOST_LIMIT", () => {
    const caps = foundingCaps(read("../../supabase/migrations/0060_founding_host.sql"));
    // 2 range/PK checks + 1 allocation ceiling + 1 remaining().
    expect(caps.length).toBeGreaterThanOrEqual(4);
    for (const n of caps) expect(n).toBe(FOUNDING_HOST_LIMIT);
  });

  it("practitioner: every cap literal in 0068 equals FOUNDING_PRACTITIONER_LIMIT", () => {
    const caps = foundingCaps(read("../../supabase/migrations/0068_founding_practitioner.sql"));
    expect(caps.length).toBeGreaterThanOrEqual(4);
    for (const n of caps) expect(n).toBe(FOUNDING_PRACTITIONER_LIMIT);
  });
});
