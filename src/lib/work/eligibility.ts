/**
 * Whether a practitioner may be matched for Work at all.
 *
 * Deliberately the SAME facts and the SAME order as the person-level half of
 * `planBooking` (lib/booking-plan): a practitioner who cannot book cannot be
 * matched, because a match ends in a session and a session has to clear the
 * booking gate. Reusing the primitives — `insuranceStatus`, `requiresCredential`,
 * `standingFor` — rather than copying their logic is what keeps "matchable" and
 * "bookable" from drifting apart.
 *
 * This is the person-level check (no specific slot). The date-accurate insurance
 * test against a request's own window lives in `matching.ts`, so a practitioner
 * whose cover lapses before one particular class is excluded from that class
 * without being marked ineligible everywhere.
 */

import type { AccountType } from "../domain";
import { type InsuranceFacts, insuranceStatus } from "../insurance";
import { requiresCredential } from "../professions";
import { type CancellationEvent, standingFor } from "../reliability";

/** What is missing before a practitioner can be surfaced to studios. */
export type WorkEligibilityGap =
  | "account"
  | "profession"
  | "identity"
  | "insurance"
  | "credential"
  | "standing";

export interface WorkEligibilityFacts {
  accountType: AccountType | null;
  /** A controlled key from lib/professions, or null until chosen. */
  profession: string | null;
  identityVerified: boolean;
  /** The staff verdict on a submitted credential — the fact only. */
  credentialVerified: boolean;
  insurance: InsuranceFacts;
  /** The practitioner's own late cancellations, for the standing pause. */
  cancellations?: readonly CancellationEvent[];
}

export interface WorkEligibility {
  /** True only when nothing is missing. */
  eligible: boolean;
  /** Everything still missing, in a stable order for a checklist UI. */
  gaps: WorkEligibilityGap[];
}

/**
 * The gate, computed from stored columns the client cannot forge. Order mirrors
 * `planBooking` so the missing-step message reads the same on both sides.
 */
export function workEligibility(
  facts: WorkEligibilityFacts,
  now: Date = new Date(),
): WorkEligibility {
  const gaps: WorkEligibilityGap[] = [];

  if (facts.accountType !== "practitioner") gaps.push("account");
  if (!facts.profession) gaps.push("profession");
  if (!facts.identityVerified) gaps.push("identity");
  if (insuranceStatus(facts.insurance, now) !== "verified") gaps.push("insurance");
  if (requiresCredential(facts.profession) && !facts.credentialVerified) gaps.push("credential");
  if (standingFor("practitioner", facts.cancellations ?? [], now).blocksNewBookings) {
    gaps.push("standing");
  }

  return { eligible: gaps.length === 0, gaps };
}

/**
 * The one thing to say and the one thing to do about a missing step — so the
 * Work home can point a practitioner at the exact screen that clears it.
 */
export function describeWorkGap(gap: WorkEligibilityGap): { title: string; cta: string } {
  switch (gap) {
    case "account":
      return { title: "Choose the practitioner side", cta: "Set up your profile" };
    case "profession":
      return { title: "Add what you do", cta: "Choose your profession" };
    case "identity":
      return { title: "Verify your identity", cta: "Verify identity" };
    case "insurance":
      return { title: "Add liability insurance", cta: "Add insurance" };
    case "credential":
      return { title: "Add your license or certificate", cta: "Add credential" };
    case "standing":
      return {
        title: "New work is paused for now",
        cta: "See when it lifts",
      };
  }
}
