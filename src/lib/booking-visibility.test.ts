import { describe, expect, it } from "vitest";

import { type HeldBookingRow, isHeldBooking } from "./booking-visibility";

/**
 * The one rule for "a real, held session, not an in-progress checkout" — shared
 * by the bookings list and the Free-plan count so they agree. The bug it fixes:
 * an unpaid instant checkout hold used to count as an upcoming session.
 */
const row = (over: Partial<HeldBookingRow>): HeldBookingRow => ({
  captured_at: null,
  approval_state: "not_required",
  authorized_at: null,
  ...over,
});

describe("isHeldBooking", () => {
  it("does NOT hold an unpaid instant checkout hold (not_required, uncaptured)", () => {
    // A fresh instant booking: card not confirmed, no host approval. A hold, not
    // a session — must not appear in the list or count toward the Free limit.
    expect(isHeldBooking(row({ approval_state: "not_required", authorized_at: "2026-01-01" }))).toBe(
      false,
    );
    expect(isHeldBooking(row({ approval_state: "not_required", authorized_at: null }))).toBe(false);
  });

  it("holds a captured (paid) booking, whatever the approval mode", () => {
    expect(isHeldBooking(row({ captured_at: "2026-01-01", approval_state: "not_required" }))).toBe(
      true,
    );
    expect(isHeldBooking(row({ captured_at: "2026-01-01", approval_state: "pending" }))).toBe(true);
  });

  it("holds a pending request whose card is authorized — preserved as committed", () => {
    expect(isHeldBooking(row({ approval_state: "pending", authorized_at: "2026-01-01" }))).toBe(
      true,
    );
  });

  it("does NOT hold a pending request with no authorization (never charged)", () => {
    expect(isHeldBooking(row({ approval_state: "pending", authorized_at: null }))).toBe(false);
  });

  it("counts only committed sessions in a mixed set", () => {
    const rows = [
      row({ captured_at: "2026-01-01" }), // paid → counts
      row({ approval_state: "pending", authorized_at: "2026-01-01" }), // pending held → counts
      row({ approval_state: "not_required", authorized_at: "2026-01-01" }), // instant hold → not
      row({ approval_state: "not_required", authorized_at: null }), // instant hold → not
    ];
    expect(rows.filter(isHeldBooking).length).toBe(2);
  });
});
