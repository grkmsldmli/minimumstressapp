/**
 * Candidate policy for future opt-in lifecycle campaigns.
 *
 * This module intentionally does not send. Campaign execution must first pass
 * the database-backed marketing consent check and use a marketing-only outbox;
 * transactional booking/safety mail must never be routed through this policy.
 */

export type MarketingLifecycle =
  | "onboarding_incomplete"
  | "host_listed_no_bookings"
  | "browsed_no_booking"
  | "first_booking_follow_up"
  | "rebooking"
  | "dormant_reactivation"
  | "host_inventory_engagement";

export interface MarketingFacts {
  accountCreatedAt: Date;
  onboardingComplete: boolean;
  isHost: boolean;
  liveListings: number;
  bookingCount: number;
  lastBrowseAt: Date | null;
  lastBookingAt: Date | null;
  lastActiveAt: Date;
}

const DAY = 24 * 60 * 60 * 1000;
const ageDays = (date: Date, now: Date) => (now.getTime() - date.getTime()) / DAY;

/** Eligible campaign families; frequency caps/dedupe belong to the future outbox. */
export function marketingLifecycleCandidates(
  facts: MarketingFacts,
  now: Date,
): MarketingLifecycle[] {
  const candidates: MarketingLifecycle[] = [];
  const accountAge = ageDays(facts.accountCreatedAt, now);

  if (!facts.onboardingComplete && accountAge >= 1 && accountAge <= 7) {
    candidates.push("onboarding_incomplete");
  }
  if (facts.isHost && facts.liveListings > 0 && facts.bookingCount === 0 && accountAge >= 7) {
    candidates.push("host_listed_no_bookings");
  }
  if (
    facts.lastBrowseAt &&
    facts.bookingCount === 0 &&
    ageDays(facts.lastBrowseAt, now) >= 1 &&
    ageDays(facts.lastBrowseAt, now) <= 3
  ) {
    candidates.push("browsed_no_booking");
  }
  if (
    facts.bookingCount === 1 &&
    facts.lastBookingAt &&
    ageDays(facts.lastBookingAt, now) >= 1 &&
    ageDays(facts.lastBookingAt, now) <= 7
  ) {
    candidates.push("first_booking_follow_up");
  }
  if (
    facts.lastBookingAt &&
    ageDays(facts.lastBookingAt, now) >= 21 &&
    ageDays(facts.lastBookingAt, now) <= 45
  ) {
    candidates.push("rebooking");
  }
  if (ageDays(facts.lastActiveAt, now) >= 60) candidates.push("dormant_reactivation");
  if (
    facts.isHost &&
    facts.liveListings > 0 &&
    facts.lastBookingAt &&
    ageDays(facts.lastBookingAt, now) >= 30
  ) {
    candidates.push("host_inventory_engagement");
  }

  return candidates;
}

export function hasMarketingConsent(preference: {
  notifyOffers: boolean;
  consentAt: Date | null;
  unsubscribedAt: Date | null;
}): boolean {
  return preference.notifyOffers && preference.consentAt !== null && preference.unsubscribedAt === null;
}
