import { describe, expect, it } from "vitest";

import {
  type EntitlementFacts,
  entitlementsFor,
  foundingHostFreeUntil,
  hasFoundingStudioDiscount,
  isStudioProActive,
  withinFoundingFreePeriod,
} from "./entitlements";
import { STUDIO_PRO_LAUNCHED_AT } from "./money";
import type { WorkEligibility } from "./work/eligibility";

const READY_WORK: WorkEligibility = { eligible: true, gaps: [] };
const NO_WORK: WorkEligibility = { eligible: false, gaps: [] };

function facts(over: Partial<EntitlementFacts>): EntitlementFacts {
  return {
    accountType: "host",
    isPro: false,
    studioProSubscription: false,
    foundingHostAt: null,
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

  it("keeps the Founding 50% discount right even with no subscription and after the free period", () => {
    const after = new Date(foundingHostFreeUntil(STUDIO_PRO_LAUNCHED_AT).getTime() + 1000);
    const e = entitlementsFor(facts({ foundingHostAt: STUDIO_PRO_LAUNCHED_AT, now: after }));
    expect(e.studioProActive).toBe(false); // free period over, not subscribed
    expect(e.foundingStudioDiscount).toBe(true); // …but the discount right is permanent
    expect(hasFoundingStudioDiscount(STUDIO_PRO_LAUNCHED_AT)).toBe(true);
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
