import { describe, expect, it } from "vitest";

import {
  type EntitlementFacts,
  entitlementsFor,
  foundingHostFreeUntil,
  foundingPractitionerFreeUntil,
  hasFoundingPractitionerDiscount,
  hasFoundingStudioDiscount,
  isPractitionerProActive,
  isStudioProActive,
  withinFoundingPractitionerFreePeriod,
  withinFoundingFreePeriod,
} from "./entitlements";
import { FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, STUDIO_PRO_LAUNCHED_AT } from "./money";
import type { WorkEligibility } from "./work/eligibility";

const READY_WORK: WorkEligibility = { eligible: true, gaps: [] };
const NO_WORK: WorkEligibility = { eligible: false, gaps: [] };

function facts(over: Partial<EntitlementFacts>): EntitlementFacts {
  return {
    accountType: "host",
    isPro: false,
    studioProSubscription: false,
    foundingHostAt: null,
    foundingPractitionerAt: null,
    foundingHostDiscountForfeitedAt: null,
    foundingPractitionerDiscountForfeitedAt: null,
    work: NO_WORK,
    now: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

const addMonths = (d: Date, n: number) => {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

describe("founding free period", () => {
  it("an existing Founding Host (awarded before launch) gets a full 6 months from launch", () => {
    const foundingHostAt = new Date("2026-05-01T00:00:00Z"); // before launch
    expect(foundingHostFreeUntil(foundingHostAt).toISOString()).toBe(
      addMonths(STUDIO_PRO_LAUNCHED_AT, 6).toISOString(),
    );
  });

  it("a Founding Host awarded after launch gets 6 months from their award", () => {
    const foundingHostAt = new Date("2027-01-15T00:00:00Z"); // after launch
    expect(foundingHostFreeUntil(foundingHostAt).toISOString()).toBe(
      addMonths(foundingHostAt, 6).toISOString(),
    );
  });

  it("is active during the free window and inactive exactly at the boundary", () => {
    const foundingHostAt = STUDIO_PRO_LAUNCHED_AT;
    const until = foundingHostFreeUntil(foundingHostAt);
    expect(withinFoundingFreePeriod(foundingHostAt, new Date(until.getTime() - 1))).toBe(true);
    expect(withinFoundingFreePeriod(foundingHostAt, until)).toBe(false); // boundary → over
    expect(withinFoundingFreePeriod(foundingHostAt, new Date(until.getTime() + 1))).toBe(false);
  });

  it("a non-founding host is never in a free period", () => {
    expect(withinFoundingFreePeriod(null, new Date())).toBe(false);
  });
});

describe("isStudioProActive", () => {
  it("is active with a live Stripe subscription and no founding status", () => {
    expect(isStudioProActive(facts({ studioProSubscription: true }))).toBe(true);
  });
  it("is active for a Founding Host inside the free period with no subscription", () => {
    expect(
      isStudioProActive(facts({ foundingHostAt: STUDIO_PRO_LAUNCHED_AT, studioProSubscription: false })),
    ).toBe(true);
  });
  it("is inactive for a Founding Host after the free period with no subscription", () => {
    expect(
      isStudioProActive(
        facts({
          foundingHostAt: STUDIO_PRO_LAUNCHED_AT,
          now: new Date(foundingHostFreeUntil(STUDIO_PRO_LAUNCHED_AT).getTime() + 1000),
        }),
      ),
    ).toBe(false);
  });
});

describe("entitlementsFor — host (Studio Pro)", () => {
  it("a free host cannot post or manage; entitlements are all off", () => {
    const e = entitlementsFor(facts({}));
    expect(e.canPostCoverage).toBe(false);
    expect(e.canManageApplicants).toBe(false);
    expect(e.canUseRoster).toBe(false);
    expect(e.studioProActive).toBe(false);
  });

  it("an active Studio Pro host can post, manage, use roster", () => {
    const e = entitlementsFor(facts({ studioProSubscription: true }));
    expect(e.canPostCoverage).toBe(true);
    expect(e.canManageApplicants).toBe(true);
    expect(e.canManageClassTemplates).toBe(true);
    expect(e.canUseRoster).toBe(true);
  });

  it("a Founding Host in the free period is fully active and exposes the free-until date", () => {
    const e = entitlementsFor(facts({ foundingHostAt: STUDIO_PRO_LAUNCHED_AT }));
    expect(e.canPostCoverage).toBe(true);
    expect(e.studioProActive).toBe(true);
    expect(e.foundingFreeUntil?.toISOString()).toBe(foundingHostFreeUntil(STUDIO_PRO_LAUNCHED_AT).toISOString());
    expect(e.foundingStudioDiscount).toBe(true);
  });

  it("keeps the Founding 50% discount after the free period when it was never forfeited", () => {
    const after = new Date(foundingHostFreeUntil(STUDIO_PRO_LAUNCHED_AT).getTime() + 1000);
    const e = entitlementsFor(facts({ foundingHostAt: STUDIO_PRO_LAUNCHED_AT, now: after }));
    expect(e.studioProActive).toBe(false); // free period over, not subscribed
    expect(e.foundingStudioDiscount).toBe(true); // …available for a first conversion (not forfeited)
    expect(hasFoundingStudioDiscount(STUDIO_PRO_LAUNCHED_AT, null)).toBe(true);
  });

  it("forfeits the Founding 50% discount once a discounted subscription has terminally ended", () => {
    const forfeited = new Date("2027-03-01T00:00:00Z");
    const e = entitlementsFor(
      facts({ foundingHostAt: STUDIO_PRO_LAUNCHED_AT, foundingHostDiscountForfeitedAt: forfeited }),
    );
    expect(e.foundingStudioDiscount).toBe(false); // the 50% right is spent…
    expect(e.foundingFreeUntil !== undefined).toBe(true); // …but founding status is untouched
    expect(hasFoundingStudioDiscount(STUDIO_PRO_LAUNCHED_AT, forfeited)).toBe(false);
    expect(hasFoundingStudioDiscount(STUDIO_PRO_LAUNCHED_AT, null)).toBe(true);
  });

  it("host Studio-Pro state never grants practitioner Work access", () => {
    const e = entitlementsFor(facts({ studioProSubscription: true }));
    expect(e.canBrowseWork).toBe(false);
    expect(e.canApplyToWork).toBe(false);
  });
});

describe("entitlementsFor — practitioner (Work)", () => {
  const prac = (over: Partial<EntitlementFacts>) =>
    entitlementsFor(facts({ accountType: "practitioner", ...over }));

  it("a free practitioner cannot browse or apply", () => {
    const e = prac({ isPro: false, work: READY_WORK });
    expect(e.canBrowseWork).toBe(false);
    expect(e.canApplyToWork).toBe(false);
  });

  it("a Pro practitioner can browse; applying also needs the verification gate", () => {
    expect(prac({ isPro: true, work: READY_WORK }).canApplyToWork).toBe(true);
    const unverified = prac({ isPro: true, work: NO_WORK });
    expect(unverified.canBrowseWork).toBe(true); // can see the board
    expect(unverified.canApplyToWork).toBe(false); // but not apply until verified
  });

  it("a practitioner is never granted host posting", () => {
    expect(prac({ isPro: true, work: READY_WORK }).canPostCoverage).toBe(false);
  });
});

describe("founding practitioner free period", () => {
  it("an existing Founding Practitioner (awarded before launch) gets a full 6 months from launch", () => {
    const at = new Date("2026-05-01T00:00:00Z"); // before launch
    expect(foundingPractitionerFreeUntil(at).toISOString()).toBe(
      addMonths(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, 6).toISOString(),
    );
  });

  it("a Founding Practitioner awarded after launch gets 6 months from their award", () => {
    const at = new Date("2027-01-15T00:00:00Z"); // after launch
    expect(foundingPractitionerFreeUntil(at).toISOString()).toBe(addMonths(at, 6).toISOString());
  });

  it("is active during the window and inactive exactly at the boundary", () => {
    const at = FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT;
    const until = foundingPractitionerFreeUntil(at);
    expect(withinFoundingPractitionerFreePeriod(at, new Date(until.getTime() - 1))).toBe(true);
    expect(withinFoundingPractitionerFreePeriod(at, until)).toBe(false); // boundary → over
    expect(withinFoundingPractitionerFreePeriod(at, new Date(until.getTime() + 1))).toBe(false);
  });

  it("a non-founding practitioner is never in a free period", () => {
    expect(withinFoundingPractitionerFreePeriod(null, new Date())).toBe(false);
  });
});

describe("isPractitionerProActive", () => {
  it("is active with a live Stripe subscription and no founding status", () => {
    expect(isPractitionerProActive(facts({ isPro: true }))).toBe(true);
  });
  it("is active for a Founding Practitioner inside the free period with no subscription", () => {
    expect(
      isPractitionerProActive(
        facts({ foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, isPro: false }),
      ),
    ).toBe(true);
  });
  it("is inactive for a Founding Practitioner after the free period with no subscription", () => {
    expect(
      isPractitionerProActive(
        facts({
          foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT,
          now: new Date(
            foundingPractitionerFreeUntil(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT).getTime() + 1000,
          ),
        }),
      ),
    ).toBe(false);
  });
});

describe("entitlementsFor — Founding Practitioner (Pro benefit)", () => {
  const prac = (over: Partial<EntitlementFacts>) =>
    entitlementsFor(facts({ accountType: "practitioner", ...over }));

  it("a Founding Practitioner in the free period can browse, with the badge and free-until date", () => {
    const e = prac({ foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, work: READY_WORK });
    expect(e.canBrowseWork).toBe(true);
    expect(e.canApplyToWork).toBe(true); // free Pro + verified
    expect(e.practitionerProActive).toBe(true);
    expect(e.foundingProFreeUntil?.toISOString()).toBe(
      foundingPractitionerFreeUntil(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT).toISOString(),
    );
    expect(e.foundingProDiscount).toBe(true);
  });

  it("in the free period but unverified: can browse, cannot apply", () => {
    const e = prac({ foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, work: NO_WORK });
    expect(e.canBrowseWork).toBe(true);
    expect(e.canApplyToWork).toBe(false);
  });

  it("keeps the 50% right after the free period when never converted (not forfeited)", () => {
    const after = new Date(
      foundingPractitionerFreeUntil(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT).getTime() + 1000,
    );
    const e = prac({ foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, now: after, work: READY_WORK });
    expect(e.practitionerProActive).toBe(false); // free period over, not subscribed
    expect(e.canBrowseWork).toBe(false); // no new browsing without active Pro
    expect(e.foundingProDiscount).toBe(true); // …but the 50% is still available for a first conversion
    expect(hasFoundingPractitionerDiscount(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, null)).toBe(true);
  });

  it("forfeits the 50% right once a discounted subscription has terminally ended", () => {
    const forfeited = new Date("2027-06-01T00:00:00Z");
    const e = prac({
      foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT,
      foundingPractitionerDiscountForfeitedAt: forfeited,
      work: READY_WORK,
    });
    expect(e.foundingProDiscount).toBe(false); // the 50% right is spent
    expect(hasFoundingPractitionerDiscount(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, forfeited)).toBe(false);
    expect(hasFoundingPractitionerDiscount(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, null)).toBe(true);
  });

  it("resubscribing after forfeiture: active Pro but no discount (full price)", () => {
    const forfeited = new Date("2027-06-01T00:00:00Z");
    const e = prac({
      foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT,
      foundingPractitionerDiscountForfeitedAt: forfeited,
      isPro: true, // resubscribed at full price
      now: new Date("2027-07-01T00:00:00Z"),
      work: READY_WORK,
    });
    expect(e.practitionerProActive).toBe(true);
    expect(e.canApplyToWork).toBe(true);
    expect(e.foundingProDiscount).toBe(false); // full price on the new subscription
  });

  it("a resubscribed (paid) Founding Practitioner is active and still holds the discount", () => {
    const after = new Date(
      foundingPractitionerFreeUntil(FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT).getTime() + 1000,
    );
    const e = prac({
      foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT,
      isPro: true,
      now: after,
      work: READY_WORK,
    });
    expect(e.practitionerProActive).toBe(true);
    expect(e.foundingProDiscount).toBe(true);
  });

  it("a Founding Practitioner's Pro state never grants host posting", () => {
    const e = prac({ foundingPractitionerAt: FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT, work: READY_WORK });
    expect(e.canPostCoverage).toBe(false);
    expect(e.studioProActive).toBe(false);
  });

  it("a Founding Host's founding status never grants a practitioner Pro benefit", () => {
    const e = entitlementsFor(
      facts({ accountType: "host", foundingHostAt: STUDIO_PRO_LAUNCHED_AT, work: READY_WORK }),
    );
    expect(e.practitionerProActive).toBe(false);
    expect(e.foundingProDiscount).toBe(false);
  });
});
