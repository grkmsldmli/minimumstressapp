/**
 * When a booking row is a real, held session rather than an in-progress or
 * abandoned checkout.
 *
 * A booking row exists the instant checkout begins — before any card is
 * confirmed, so `captured_at` is null, and for an instant booking
 * `approval_state` is "not_required". That is a hold, not a session the
 * practitioner has: it must not appear in their bookings list, and it must not
 * count against the Free plan's upcoming-sessions limit. A checkout that is
 * abandoned is reaped 30 minutes later (see abandoned.ts); until then it may
 * still occupy its slot, but it is never a committed session.
 *
 * Two states qualify as held:
 *  - `captured_at` is set — the money arrived (paid), whatever the approval mode.
 *  - `approval_state` is "pending" with `authorized_at` set — a request the host
 *    has yet to answer, its card held; the architecture already treats that as a
 *    live, committed booking.
 *
 * One definition, used by both the bookings list and the Free-limit count, so
 * the two can never disagree about what a real booking is.
 */
export interface HeldBookingRow {
  captured_at: string | null;
  approval_state?: string | null;
  authorized_at?: string | null;
}

export function isHeldBooking(row: HeldBookingRow): boolean {
  if (row.captured_at !== null) return true;
  return row.approval_state === "pending" && (row.authorized_at ?? null) !== null;
}
