/**
 * Bookings that took an hour off the calendar and never paid for it.
 *
 * The row goes in before the card is charged, deliberately — the alternative
 * is a charge with no record explaining it. `booking-service` says as much and
 * calls the result "visible, unpaid, and safe to reap". Nothing reaped it.
 *
 * What that costs, in order of who notices:
 *
 * - The host loses the hour. The availability check excludes anything
 *   `upcoming`, so an abandoned checkout blocks the slot for everybody, for
 *   good, and nobody was charged for it.
 * - The practitioner loses their allowance. A free account holds three
 *   sessions at once, so three closed tabs and they can never book again —
 *   with nothing on any screen explaining why.
 * - The operator's numbers lie. "Booked this month" counts money that was
 *   never taken.
 *
 * The rules are here and pure so the job that runs them can be dull.
 */

/**
 * How long somebody gets at the card form before the hour goes back.
 *
 * Generous on purpose. Somebody digs their card out of another room, or
 * finishes a call first, and thirty minutes covers that without leaving a
 * studio's Tuesday morning dead until somebody notices by hand.
 */
export const CHECKOUT_GRACE_MINUTES = 30;

export interface UnpaidBooking {
  id: string;
  createdAt: Date;
  /** When the money actually arrived. Null is the whole point of this file. */
  capturedAt: Date | null;
  status: string;
  startsAt: Date;
  paymentIntentId: string | null;
}

/**
 * Whether this booking should be given up on.
 *
 * Note what is *not* a reason: how close the session is. A booking made two
 * minutes before its own hour is exactly when somebody is still typing, and
 * reaping it early would take a room away from the person about to pay for it.
 * Time since the attempt is the only clock that matters.
 */
export function isAbandoned(booking: UnpaidBooking, now: Date): boolean {
  if (booking.status !== "upcoming") return false;
  if (booking.capturedAt !== null) return false;

  const waited = now.getTime() - booking.createdAt.getTime();
  return waited >= CHECKOUT_GRACE_MINUTES * 60_000;
}

/** The cutoff a query can use, so the database does the filtering. */
export function abandonedBefore(now: Date): Date {
  return new Date(now.getTime() - CHECKOUT_GRACE_MINUTES * 60_000);
}
