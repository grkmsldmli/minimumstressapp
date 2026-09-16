/** Candidate policy for the opt-in, marketing-only lifecycle outbox. */

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
  firstLiveListingAt: Date | null;
  bookingCount: number;
  lastBrowseAt: Date | null;
  lastBookingAt: Date | null;
  lastActiveAt: Date;
}

const DAY = 24 * 60 * 60 * 1000;
const ageDays = (date: Date, now: Date) => (now.getTime() - date.getTime()) / DAY;

/** Eligible campaign families. Durable dedupe and frequency caps live in Postgres. */
export function marketingLifecycleCandidates(
  facts: MarketingFacts,
  now: Date,
): MarketingLifecycle[] {
  const candidates: MarketingLifecycle[] = [];
  const accountAge = ageDays(facts.accountCreatedAt, now);

  if (!facts.onboardingComplete && accountAge >= 1 && accountAge <= 7) {
    candidates.push("onboarding_incomplete");
  }
  if (
    facts.isHost &&
    facts.liveListings > 0 &&
    facts.bookingCount === 0 &&
    facts.firstLiveListingAt &&
    ageDays(facts.firstLiveListingAt, now) >= 7
  ) {
    candidates.push("host_listed_no_bookings");
  }
  if (
    !facts.isHost &&
    facts.lastBrowseAt &&
    facts.bookingCount === 0 &&
    ageDays(facts.lastBrowseAt, now) >= 1 &&
    ageDays(facts.lastBrowseAt, now) <= 3
  ) {
    candidates.push("browsed_no_booking");
  }
  if (
    !facts.isHost &&
    facts.bookingCount === 1 &&
    facts.lastBookingAt &&
    ageDays(facts.lastBookingAt, now) >= 1 &&
    ageDays(facts.lastBookingAt, now) <= 7
  ) {
    candidates.push("first_booking_follow_up");
  }
  if (
    !facts.isHost &&
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

/**
 * Stable lifecycle instance used inside the outbox unique key.
 *
 * One-shot journeys never repeat. Browse/rebook journeys are tied to the exact
 * activity that made them eligible. Long-running dormant/inventory journeys
 * may repeat, but only after a deliberately wide new cycle opens.
 */
export function marketingLifecycleBucket(
  campaign: MarketingLifecycle,
  facts: MarketingFacts,
  now: Date,
): string {
  switch (campaign) {
    case "onboarding_incomplete":
    case "host_listed_no_bookings":
    case "first_booking_follow_up":
      return "first";
    case "browsed_no_booking":
      return `browse:${requiredDate(facts.lastBrowseAt).toISOString()}`;
    case "rebooking":
      return `booking:${requiredDate(facts.lastBookingAt).toISOString()}`;
    case "dormant_reactivation": {
      const cycle = Math.max(0, Math.floor((ageDays(facts.lastActiveAt, now) - 60) / 90));
      return `inactive:${facts.lastActiveAt.toISOString()}:${cycle}`;
    }
    case "host_inventory_engagement": {
      const lastBooking = requiredDate(facts.lastBookingAt);
      const cycle = Math.max(0, Math.floor((ageDays(lastBooking, now) - 30) / 60));
      return `inventory:${lastBooking.toISOString()}:${cycle}`;
    }
  }
}

export const MARKETING_LIFECYCLE_PRIORITY: readonly MarketingLifecycle[] = [
  "onboarding_incomplete",
  "first_booking_follow_up",
  "host_listed_no_bookings",
  "browsed_no_booking",
  "rebooking",
  "host_inventory_engagement",
  "dormant_reactivation",
];

export function orderMarketingLifecycles(
  campaigns: readonly MarketingLifecycle[],
): MarketingLifecycle[] {
  const set = new Set(campaigns);
  return MARKETING_LIFECYCLE_PRIORITY.filter((campaign) => set.has(campaign));
}

function requiredDate(value: Date | null): Date {
  if (!value) throw new RangeError("Campaign activity date is required");
  return value;
}

export function hasMarketingConsent(preference: {
  notifyOffers: boolean;
  consentAt: Date | null;
  unsubscribedAt: Date | null;
}): boolean {
  return preference.notifyOffers && preference.consentAt !== null && preference.unsubscribedAt === null;
}
