import { describe, expect, it } from "vitest";

import type { InsuranceFacts } from "../insurance";
import type { CancellationEvent } from "../reliability";
import { type WorkEligibilityFacts, workEligibility } from "./eligibility";

const NOW = new Date("2026-06-15T12:00:00Z");

const VERIFIED_INSURANCE: InsuranceFacts = {
  hasCertificate: true,
  state: "verified",
  effectiveDate: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2027-01-01T00:00:00Z"),
};

const READY: WorkEligibilityFacts = {
  accountType: "practitioner",
  profession: "pilates",
  identityVerified: true,
  credentialVerified: true,
  insurance: VERIFIED_INSURANCE,
  cancellations: [],
};

/** A late cancellation `daysAgo` days before NOW, 1 hour before its session. */
function lateCancellation(daysAgo: number): CancellationEvent {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return { at, sessionStart: new Date(at.getTime() + 60 * 60_000), by: "practitioner" };
}

describe("workEligibility", () => {
  it("is eligible when the whole professional profile is verified", () => {
    expect(workEligibility(READY, NOW)).toEqual({ eligible: true, gaps: [] });
  });

  it("mirrors the booking gate: a host account is not matchable", () => {
    const { eligible, gaps } = workEligibility({ ...READY, accountType: "host" }, NOW);
    expect(eligible).toBe(false);
    expect(gaps).toContain("account");
  });

  it("needs a chosen profession", () => {
    expect(workEligibility({ ...READY, profession: null }, NOW).gaps).toContain("profession");
  });

  it("needs a verified identity", () => {
    expect(workEligibility({ ...READY, identityVerified: false }, NOW).gaps).toContain("identity");
  });

  it("needs verified insurance (a pending certificate is not enough)", () => {
    const facts = { ...READY, insurance: { ...VERIFIED_INSURANCE, state: "pending" as const } };
    expect(workEligibility(facts, NOW).gaps).toContain("insurance");
  });

  it("needs a verified credential", () => {
    expect(workEligibility({ ...READY, credentialVerified: false }, NOW).gaps).toContain("credential");
  });

  it("is not matchable while standing is paused for late cancellations", () => {
    const facts = {
      ...READY,
      cancellations: [lateCancellation(1), lateCancellation(2), lateCancellation(3)],
    };
    const { eligible, gaps } = workEligibility(facts, NOW);
    expect(eligible).toBe(false);
    expect(gaps).toContain("standing");
  });

  it("lists every missing step at once, in a stable order", () => {
    const facts: WorkEligibilityFacts = {
      accountType: null,
      profession: null,
      identityVerified: false,
      credentialVerified: false,
      insurance: { hasCertificate: false, state: "pending", effectiveDate: null, expiresAt: null },
      cancellations: [],
    };
    expect(workEligibility(facts, NOW).gaps).toEqual([
      "account",
      "profession",
      "identity",
      "insurance",
      "credential",
    ]);
  });
});
