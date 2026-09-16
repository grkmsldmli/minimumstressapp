import { describe, expect, it } from "vitest";

import {
  hasMarketingConsent,
  marketingLifecycleBucket,
  marketingLifecycleCandidates,
  orderMarketingLifecycles,
} from "./lifecycle";

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
          firstLiveListingAt: daysAgo(8),
          bookingCount: 0,
          lastBrowseAt: daysAgo(2),
          lastBookingAt: null,
          lastActiveAt: daysAgo(1),
        },
        now,
      ),
    ).toEqual(["host_listed_no_bookings"]);
  });

  it("does not keep an onboarding or browse nudge alive indefinitely", () => {
    expect(
      marketingLifecycleCandidates(
        {
          accountCreatedAt: daysAgo(30),
          onboardingComplete: false,
          isHost: false,
          liveListings: 0,
          firstLiveListingAt: null,
          bookingCount: 0,
          lastBrowseAt: daysAgo(10),
          lastBookingAt: null,
          lastActiveAt: daysAgo(2),
        },
        now,
      ),
    ).toEqual([]);
  });

  it("can surface dormancy and stale host inventory independently", () => {
    expect(
      marketingLifecycleCandidates(
        {
          accountCreatedAt: daysAgo(400),
          onboardingComplete: true,
          isHost: true,
          liveListings: 2,
          firstLiveListingAt: daysAgo(300),
          bookingCount: 12,
          lastBrowseAt: null,
          lastBookingAt: daysAgo(35),
          lastActiveAt: daysAgo(75),
        },
        now,
      ),
    ).toEqual(["dormant_reactivation", "host_inventory_engagement"]);
  });

  it("keeps practitioner rebooking journeys away from host accounts", () => {
    expect(
      marketingLifecycleCandidates(
        {
          accountCreatedAt: daysAgo(400),
          onboardingComplete: true,
          isHost: true,
          liveListings: 1,
          firstLiveListingAt: daysAgo(200),
          bookingCount: 1,
          lastBrowseAt: daysAgo(2),
          lastBookingAt: daysAgo(3),
          lastActiveAt: daysAgo(1),
        },
        now,
      ),
    ).toEqual([]);
  });

  it("waits seven days after the listing itself goes live", () => {
    expect(
      marketingLifecycleCandidates(
        {
          accountCreatedAt: daysAgo(90),
          onboardingComplete: true,
          isHost: true,
          liveListings: 1,
          firstLiveListingAt: daysAgo(2),
          bookingCount: 0,
          lastBrowseAt: null,
          lastBookingAt: null,
          lastActiveAt: daysAgo(1),
        },
        now,
      ),
    ).toEqual([]);
  });
});

describe("marketing lifecycle dedupe", () => {
  const facts = {
    accountCreatedAt: daysAgo(400),
    onboardingComplete: true,
    isHost: false,
    liveListings: 0,
    firstLiveListingAt: null,
    bookingCount: 2,
    lastBrowseAt: daysAgo(2),
    lastBookingAt: daysAgo(30),
    lastActiveAt: daysAgo(61),
  };

  it("ties browse and rebooking mail to the activity that earned it", () => {
    expect(marketingLifecycleBucket("browsed_no_booking", facts, now)).toContain(
      facts.lastBrowseAt.toISOString(),
    );
    expect(marketingLifecycleBucket("rebooking", facts, now)).toContain(
      facts.lastBookingAt.toISOString(),
    );
  });

  it("opens a new dormant cycle only after another ninety days", () => {
    expect(marketingLifecycleBucket("dormant_reactivation", facts, now)).toMatch(/:0$/);
    expect(
      marketingLifecycleBucket(
        "dormant_reactivation",
        { ...facts, lastActiveAt: daysAgo(151) },
        now,
      ),
    ).toMatch(/:1$/);
  });

  it("orders competing journeys by user value", () => {
    expect(
      orderMarketingLifecycles(["dormant_reactivation", "rebooking", "browsed_no_booking"]),
    ).toEqual(["browsed_no_booking", "rebooking", "dormant_reactivation"]);
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
