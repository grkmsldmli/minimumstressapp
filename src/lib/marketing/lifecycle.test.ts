import { describe, expect, it } from "vitest";

import { hasMarketingConsent, marketingLifecycleCandidates } from "./lifecycle";

const now = new Date("2026-09-16T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("marketing lifecycle candidate policy", () => {
  it("identifies the opt-in journeys whose timing window is open", () => {
    expect(
      marketingLifecycleCandidates(
        {
          accountCreatedAt: daysAgo(8),
          onboardingComplete: true,
          isHost: true,
          liveListings: 1,
          bookingCount: 0,
          lastBrowseAt: daysAgo(2),
          lastBookingAt: null,
          lastActiveAt: daysAgo(1),
        },
        now,
      ),
    ).toEqual(["host_listed_no_bookings", "browsed_no_booking"]);
  });

  it("does not keep an onboarding or browse nudge alive indefinitely", () => {
    expect(
      marketingLifecycleCandidates(
        {
          accountCreatedAt: daysAgo(30),
          onboardingComplete: false,
          isHost: false,
          liveListings: 0,
          bookingCount: 0,
          lastBrowseAt: daysAgo(10),
          lastBookingAt: null,
          lastActiveAt: daysAgo(2),
        },
        now,
      ),
    ).toEqual([]);
  });

  it("can surface rebooking, dormancy and stale host inventory independently", () => {
    expect(
      marketingLifecycleCandidates(
        {
          accountCreatedAt: daysAgo(400),
          onboardingComplete: true,
          isHost: true,
          liveListings: 2,
          bookingCount: 12,
          lastBrowseAt: null,
          lastBookingAt: daysAgo(35),
          lastActiveAt: daysAgo(75),
        },
        now,
      ),
    ).toEqual(["rebooking", "dormant_reactivation", "host_inventory_engagement"]);
  });
});

describe("marketing consent gate", () => {
  it("requires all three pieces of affirmative, current consent", () => {
    expect(
      hasMarketingConsent({ notifyOffers: true, consentAt: daysAgo(1), unsubscribedAt: null }),
    ).toBe(true);
    expect(
      hasMarketingConsent({ notifyOffers: false, consentAt: daysAgo(1), unsubscribedAt: null }),
    ).toBe(false);
    expect(
      hasMarketingConsent({ notifyOffers: true, consentAt: null, unsubscribedAt: null }),
    ).toBe(false);
    expect(
      hasMarketingConsent({
        notifyOffers: true,
        consentAt: daysAgo(2),
        unsubscribedAt: daysAgo(1),
      }),
    ).toBe(false);
  });
});
