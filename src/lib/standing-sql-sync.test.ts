import { describe, expect, it } from "vitest";

import { LATE_CANCELLATION_HOURS, STANDING_WINDOW_DAYS, THRESHOLDS } from "./reliability";

/**
 * host_requests() and host_bookings() compute `good_standing` in SQL (migration
 * 0057), because standingFor() cannot be called from Postgres. That is the one
 * place the Standing rule is expressed twice, so this pins the numbers the SQL
 * hard-codes to reliability.ts — the source of truth. Change the rule here and
 * this fails until the migration's `< 2`, `interval '90 days'` and
 * `interval '24 hours'` are updated to match. It does not replace centralising
 * the logic; it stops the two copies drifting silently until we do.
 */
describe("good_standing SQL mirrors the Standing rule", () => {
  it("uses the same 90-day window the SQL hard-codes", () => {
    expect(STANDING_WINDOW_DAYS).toBe(90);
  });

  it("uses the same 24-hour lateness line the SQL hard-codes", () => {
    expect(LATE_CANCELLATION_HOURS).toBe(24);
  });

  it("uses the same warn threshold the SQL compares against (good_standing = count < 2)", () => {
    expect(THRESHOLDS.practitioner.warnAt).toBe(2);
  });
});
