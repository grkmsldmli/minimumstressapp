/**
 * A professional's liability cover: what state it is in, and whether it covers
 * a given booking.
 *
 * Two questions, kept apart. `insuranceStatus` is what a person sees on their
 * profile — one of five plain words. `checkInsuranceForBooking` is the gate the
 * server runs before a booking is confirmed, and it answers a narrower thing:
 * is there verified cover that is active on *this* date. A file being uploaded
 * is not either of those — verification is a person reading it, and validity is
 * a window with two ends.
 *
 * Pure, so booking-plan can enforce it and the tests can exhaust it without a
 * database. booking-service feeds it the stored row; the client cannot.
 */

/** The stored review state, mirroring the doc_review_state enum in the DB. */
export type InsuranceState = "pending" | "verified" | "rejected";

/** What a professional is shown, derived from the stored row and the clock. */
export type InsuranceStatus =
  | "not_added"
  | "pending_review"
  | "verified"
  | "rejected"
  | "expired";

/**
 * The stored facts the gate reasons about. `hasCertificate` is whether a
 * document was ever uploaded (profiles.insurance_doc_path); the dates are the
 * policy window, present only once staff have verified it.
 */
export interface InsuranceFacts {
  hasCertificate: boolean;
  state: InsuranceState;
  effectiveDate: Date | null;
  expiresAt: Date | null;
}

/** A policy dated "expires Aug 1" covers all of Aug 1, so the day is inclusive. */
const DAY_MS = 24 * 60 * 60 * 1000;
function endOfExpiryDay(expires: Date): number {
  return expires.getTime() + DAY_MS - 1;
}

/**
 * The five-word status for the profile screen.
 *
 * "expired" is derived, not stored: a certificate stays 'verified' in the
 * database and simply ages out of its window, so the same row reads verified
 * today and expired next year without anyone rewriting it.
 */
export function insuranceStatus(facts: InsuranceFacts, now: Date): InsuranceStatus {
  if (!facts.hasCertificate) return "not_added";
  if (facts.state === "rejected") return "rejected";
  if (facts.state === "pending") return "pending_review";
  // Verified in the database — but only "verified" to the person while the
  // window is still open.
  if (facts.expiresAt && endOfExpiryDay(facts.expiresAt) < now.getTime()) return "expired";
  return "verified";
}

/** True when this cover holds for the whole of a session's interval. */
export function insuranceCoversInterval(
  facts: InsuranceFacts,
  startsAt: Date,
  endsAt: Date,
): boolean {
  return checkInsuranceForBooking(facts, startsAt, endsAt, startsAt) === null;
}

export type InsuranceRejection =
  | "insurance_required"
  | "insurance_pending"
  | "insurance_rejected"
  | "insurance_expired"
  | "insurance_not_valid_for_date";

/**
 * The booking gate. Returns the first reason cover is not good for this
 * session, or null when it is.
 *
 * The whole interval is checked, not just the day it starts: cover must be
 * effective by `startsAt` and still active through `endsAt`. A policy that
 * begins after the session starts, or lapses before it ends, does not cover it
 * — a session running 23:30–00:30 on the last day of a policy is not covered to
 * the end, and this is where that is caught.
 *
 * `now` is separate from the interval on purpose: a policy can be live today
 * (not expired) and still not reach a session months out — that is
 * `insurance_not_valid_for_date`, distinct from a policy that has already
 * lapsed (`insurance_expired`). The recurring flow leans on exactly this: every
 * occurrence is a different interval against the same window.
 */
export function checkInsuranceForBooking(
  facts: InsuranceFacts,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): InsuranceRejection | null {
  if (!facts.hasCertificate) return "insurance_required";
  if (facts.state === "rejected") return "insurance_rejected";
  if (facts.state === "pending") return "insurance_pending";

  // Verified. The DB constraint guarantees both dates on a verified row, but a
  // missing one here is treated as "no usable cover" rather than trusted.
  if (!facts.effectiveDate || !facts.expiresAt) return "insurance_required";

  // Lapsed already: dead cover, whatever the session's dates.
  if (endOfExpiryDay(facts.expiresAt) < now.getTime()) return "insurance_expired";

  // Live cover, but does it hold for the whole session? Effective by the moment
  // it begins, and still active at the moment it ends.
  if (
    startsAt.getTime() < facts.effectiveDate.getTime() ||
    endsAt.getTime() > endOfExpiryDay(facts.expiresAt)
  ) {
    return "insurance_not_valid_for_date";
  }

  return null;
}
