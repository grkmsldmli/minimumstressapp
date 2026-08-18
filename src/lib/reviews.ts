/**
 * What each side says about the other afterwards, and when anyone gets to see
 * it.
 *
 * Pure functions over plain data, so the rules that decide whether a review is
 * allowed, whether it is visible, and whether it needs a human can be tested
 * without a database. Every one of those three has a wrong answer that is
 * quiet: a review shown too early, a concern that never reaches anybody, a
 * rating that lets someone rate a session that has not happened.
 */

export type ReviewerRole = "practitioner" | "host";

/** One to five. Narrowed to a union so an out-of-range number cannot be stored. */
export type Rating = 1 | 2 | 3 | 4 | 5;

export function isRating(value: unknown): value is Rating {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/**
 * A practitioner's answers about the room and the host.
 *
 * The sub-questions are the ones a host can actually act on. "It was fine" is
 * not a repair instruction; "the code did not work" is.
 */
export interface PractitionerReview {
  overall: Rating;
  /** Was the door code or key waiting, and did it work? */
  accessOnTime: boolean;
  cleanliness: Rating;
  /** Did the room match what the listing promised? */
  accuracy: Rating;
  wouldBookAgain: boolean;
}

/** A host's answers about the practitioner. */
export interface HostReview {
  overall: Rating;
  /** Reset, tidied, nothing moved that was not moved back. */
  leftAsFound: Rating;
  respectedHouseRules: boolean;
  onTime: boolean;
  wouldHostAgain: boolean;
}

export interface Review {
  bookingId: string;
  role: ReviewerRole;
  overall: Rating;
  comment: string;
  /**
   * Ticked by the reviewer, independent of the stars.
   *
   * A five-star session can still end with something that needs looking at —
   * an unlocked fire door, a stranger in the building, a first-aid box that
   * was empty. Tying escalation only to a low rating would lose exactly the
   * reports that are most worth having, because people are reluctant to give
   * a bad rating to someone they otherwise liked.
   */
  safetyConcern: boolean;
  submittedAt: Date;
}

/**
 * At or below this, a person reads it.
 *
 * Three is not a disaster on most scales, which is the point: by the time
 * someone writes two stars the problem has usually already happened twice.
 */
export const ESCALATION_THRESHOLD: Rating = 3;

/** How long a review stays sealed while the other side has not answered. */
export const BLIND_PERIOD_DAYS = 14;

/** After this, the session is too far back to remember accurately. */
export const REVIEW_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewEligibility =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "session_not_finished"
        | "window_closed"
        | "already_reviewed"
        | "booking_cancelled"
        | "never_paid";
    };

/**
 * Whether this person may review this booking right now.
 *
 * A cancelled booking is deliberately not reviewable. Nobody was in the room,
 * so there is nothing to report — and a cancellation already has its own
 * consequences through the reliability rules, which is where a repeated
 * canceller is dealt with.
 */
export function canReview(
  booking: { endsAt: Date; status: string; capturedAt: Date | null },
  alreadySubmitted: boolean,
  now: Date,
): ReviewEligibility {
  /*
   * Paid for, which is the same correction claims.ts already carries.
   *
   * An abandoned checkout sits at `upcoming` with no money taken, and the
   * reaper that clears it runs twice a day — so once its hour passes, every
   * other test here says yes. A review could be written about a session
   * nobody paid for and nobody attended, and a low one or a ticked safety box
   * would raise an escalation against it: a safety report about an hour that
   * did not happen, which costs a real person a real answer.
   *
   * `captured_at` is the column that means money was taken. The status does
   * not distinguish a paid booking from an abandoned one.
   */
  if (booking.capturedAt === null) {
    return { allowed: false, reason: "never_paid" };
  }
  if (booking.status.startsWith("cancelled")) {
    return { allowed: false, reason: "booking_cancelled" };
  }
  if (alreadySubmitted) return { allowed: false, reason: "already_reviewed" };
  if (now < booking.endsAt) return { allowed: false, reason: "session_not_finished" };
  if (now.getTime() > booking.endsAt.getTime() + REVIEW_WINDOW_DAYS * DAY_MS) {
    return { allowed: false, reason: "window_closed" };
  }
  return { allowed: true };
}

/**
 * Whether a submitted review is visible yet.
 *
 * Sealed until both sides have written, or until the blind period runs out.
 * Publishing the first one immediately turns the second into a reply: a host
 * who reads three stars before writing their own has every reason to answer
 * in kind, and the second review stops being about the session. The window
 * exists so one side staying silent cannot seal the other's forever.
 */
export function isVisible(
  own: { submittedAt: Date } | null,
  counterpart: { submittedAt: Date } | null,
  now: Date,
): boolean {
  if (!own) return false;
  if (counterpart) return true;
  return now.getTime() >= own.submittedAt.getTime() + BLIND_PERIOD_DAYS * DAY_MS;
}

/** Whether this review needs a human to look at it before anything else happens. */
export function needsEscalation(review: Pick<Review, "overall" | "safetyConcern">): boolean {
  return review.safetyConcern || review.overall <= ESCALATION_THRESHOLD;
}

/**
 * How urgently, so a queue can be ordered when several arrive at once.
 *
 * A stated safety concern outranks a low rating no matter what the stars say,
 * because one describes a risk and the other describes a disappointment.
 */
export function escalationPriority(
  review: Pick<Review, "overall" | "safetyConcern">,
): "safety" | "urgent" | "review" | null {
  if (review.safetyConcern) return "safety";
  if (review.overall <= 2) return "urgent";
  if (review.overall === ESCALATION_THRESHOLD) return "review";
  return null;
}

/** Below this many reviews, an average says more about luck than about quality. */
export const MIN_REVIEWS_FOR_AVERAGE = 3;

export interface RatingSummary {
  /** Null until there are enough reviews for the number to mean anything. */
  average: number | null;
  count: number;
  /** True while a listing is too new to have earned an average. */
  isNew: boolean;
}

/**
 * The rating shown on a listing.
 *
 * Withheld under three reviews rather than shown with a caveat. A single
 * three-star review renders as "3.0" next to a competitor's "4.9" and reads as
 * settled fact; "New" is both truer and fairer, and it stops one bad first
 * night from deciding whether a studio ever gets a second booking.
 */
export function summarise(ratings: Rating[]): RatingSummary {
  const count = ratings.length;
  const total = ratings.reduce((sum, r) => sum + r, 0);
  return summariseAggregate(count, count === 0 ? null : total / count);
}

/**
 * The same rule, from a count and an average rather than the ratings.
 *
 * The database aggregates for us — `space_ratings` returns a count and a mean
 * — and a caller holding those two numbers should not have to invent a
 * plausible array of stars to get an answer. Both entry points end here, so
 * "too new for an average" is decided in one place.
 */
export function summariseAggregate(count: number, average: number | null): RatingSummary {
  if (count < MIN_REVIEWS_FOR_AVERAGE || average === null) {
    return { average: null, count, isNew: true };
  }

  // One decimal, rounded half-up, so 4.25 shows as 4.3 rather than 4.2.
  return { average: Math.round(average * 10) / 10, count, isNew: false };
}

/** When the other side stops being able to answer, for showing a countdown. */
export function blindPeriodEndsAt(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + BLIND_PERIOD_DAYS * DAY_MS);
}

/** The last moment this booking can be reviewed. */
export function reviewWindowClosesAt(endsAt: Date): Date {
  return new Date(endsAt.getTime() + REVIEW_WINDOW_DAYS * DAY_MS);
}
