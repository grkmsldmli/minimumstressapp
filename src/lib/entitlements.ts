/**
 * What each account may do with Work, decided in one place.
 *
 * The third member of the planBooking / workEligibility family: a PURE function
 * over stored, server-written columns the client cannot forge, so the SAME
 * computation is authoritative on the server (every Work route re-checks it) and
 * safe to run on the client for rendering (it only spares a round trip). The UI
 * consumes the booleans; the server owns the truth.
 *
 * Two products, kept apart on purpose (never overload `is_pro`):
 *   practitioner Pro  → profiles.is_pro        → browse + apply to Work
 *   Studio Pro (host) → profiles.studio_pro    → post + manage coverage
 *
 * Each Pro is active either through a paid/trialing Stripe subscription OR
 * through a founding cohort's automatic free period — Studio Pro through a
 * Founding Host's, practitioner Pro through a Founding Practitioner's. Both free
 * periods are DERIVED here, never a Stripe trial, because a founding member is
 * given the free months with no card and no auto-created subscription. Each
 * founding cohort also carries a permanent 50%-off right to its Pro, modelled as
 * "50% forever" against the applicable list price (a Stripe coupon), not a
 * hardcoded amount — so a later price change carries the discount with it.
 */

import type { AccountType } from "./domain";
import {
  FOUNDING_HOST_FREE_MONTHS,
  FOUNDING_PRACTITIONER_FREE_MONTHS,
  FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT,
  STUDIO_PRO_LAUNCHED_AT,
} from "./money";
import type { WorkEligibility } from "./work/eligibility";

/**
 * The end of a founding free period, for either cohort.
 *
 * Measured from max(awardedAt, launch) so someone who earned their founding
 * status before the paid product existed still gets the full free months from
 * launch, and someone who earns it later gets the months from their award. No
 * fabricated timestamps — the award dates are server-written and backfilled
 * (migrations 0060 host, 0068 practitioner).
 */
function freeUntil(awardedAt: Date, launchedAt: Date, months: number): Date {
  const start = awardedAt.getTime() > launchedAt.getTime() ? awardedAt : launchedAt;
  const until = new Date(start.getTime());
  until.setUTCMonth(until.getUTCMonth() + months);
  return until;
}

function withinFree(awardedAt: Date | null, launchedAt: Date, months: number, now: Date): boolean {
  if (!awardedAt) return false;
  return now.getTime() < freeUntil(awardedAt, launchedAt, months).getTime();
}

/* ---- Founding Host → Studio Pro ---- */

export function foundingHostFreeUntil(foundingHostAt: Date): Date {
  return freeUntil(foundingHostAt, STUDIO_PRO_LAUNCHED_AT, FOUNDING_HOST_FREE_MONTHS);
}

/** True while a Founding Host is inside their free six months of Studio Pro. */
export function withinFoundingFreePeriod(foundingHostAt: Date | null, now: Date): boolean {
  return withinFree(foundingHostAt, STUDIO_PRO_LAUNCHED_AT, FOUNDING_HOST_FREE_MONTHS, now);
}

/** Whether a host holds the permanent Founding-Host right to Studio Pro at 50% off. */
export function hasFoundingStudioDiscount(foundingHostAt: Date | null): boolean {
  return foundingHostAt !== null;
}

/* ---- Founding Practitioner → practitioner Pro (the mirror) ---- */

export function foundingPractitionerFreeUntil(foundingPractitionerAt: Date): Date {
  return freeUntil(
    foundingPractitionerAt,
    FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT,
    FOUNDING_PRACTITIONER_FREE_MONTHS,
  );
}

/** True while a Founding Practitioner is inside their free six months of Pro. */
export function withinFoundingPractitionerFreePeriod(
  foundingPractitionerAt: Date | null,
  now: Date,
): boolean {
  return withinFree(
    foundingPractitionerAt,
    FOUNDING_PRACTITIONER_PRO_LAUNCHED_AT,
    FOUNDING_PRACTITIONER_FREE_MONTHS,
    now,
  );
}

/** Whether a practitioner holds the permanent Founding-Practitioner right to Pro at 50% off. */
export function hasFoundingPractitionerDiscount(foundingPractitionerAt: Date | null): boolean {
  return foundingPractitionerAt !== null;
}

export interface EntitlementFacts {
  accountType: AccountType | null;
  /** A paid/trialing practitioner Pro Stripe subscription (profiles.is_pro), webhook-written. */
  isPro: boolean;
  /** A paid/trialing Studio Pro Stripe subscription (profiles.studio_pro), webhook-written. */
  studioProSubscription: boolean;
  /** When this host became a Founding Host, or null. Drives the Studio Pro free period + discount. */
  foundingHostAt: Date | null;
  /** When this practitioner became a Founding Practitioner, or null. Drives the Pro free period + discount. */
  foundingPractitionerAt: Date | null;
  /** The verification gate (workEligibility) — only meaningful for a practitioner. */
  work: WorkEligibility;
  now: Date;
}

/** Studio Pro active = a live Stripe subscription OR the Founding-Host free period. */
export function isStudioProActive(facts: EntitlementFacts): boolean {
  return facts.studioProSubscription || withinFoundingFreePeriod(facts.foundingHostAt, facts.now);
}

/** Practitioner Pro active = a live Stripe subscription OR the Founding-Practitioner free period. */
export function isPractitionerProActive(facts: EntitlementFacts): boolean {
  return facts.isPro || withinFoundingPractitionerFreePeriod(facts.foundingPractitionerAt, facts.now);
}

export interface Entitlements {
  /** See the coverage job board. */
  canBrowseWork: boolean;
  /** Express interest on a request (also needs the verification gate). */
  canApplyToWork: boolean;
  /** Post a coverage request. */
  canPostCoverage: boolean;
  /** List applicants and confirm one. */
  canManageApplicants: boolean;
  /** Create/edit/archive class templates. */
  canManageClassTemplates: boolean;
  /** Use My Roster. */
  canUseRoster: boolean;
  /** Practitioner Pro is active (paid or founding free) — drives the practitioner PRO badge. */
  practitionerProActive: boolean;
  /** The end of the practitioner founding free period, when in one (for reminders). */
  foundingProFreeUntil: Date | null;
  /** This practitioner holds the permanent Founding 50%-off right to Pro. */
  foundingProDiscount: boolean;
  /** Studio Pro is active (paid or founding free) — drives the host PRO badge. */
  studioProActive: boolean;
  /** The end of the host founding free period, when the host is in one (for reminders). */
  foundingFreeUntil: Date | null;
  /** This host holds the permanent Founding 50%-off right to Studio Pro. */
  foundingStudioDiscount: boolean;
}

/**
 * Managing EXISTING commitments (withdrawing a pending application, confirming an
 * applicant on a request posted while entitled, cancelling one) is never gated
 * here — those are owner actions checked by ownership, not by a live plan, so a
 * lapsed subscription can never strand live work. These booleans gate only NEW
 * browse/apply/post/manage-templates/roster actions.
 */
export function entitlementsFor(facts: EntitlementFacts): Entitlements {
  const isPractitioner = facts.accountType === "practitioner";
  const isHost = facts.accountType === "host";
  const spActive = isStudioProActive(facts);
  const proActive = isPractitionerProActive(facts);
  const inHostFree = withinFoundingFreePeriod(facts.foundingHostAt, facts.now);
  const inProFree = withinFoundingPractitionerFreePeriod(facts.foundingPractitionerAt, facts.now);

  return {
    canBrowseWork: isPractitioner && proActive,
    canApplyToWork: isPractitioner && proActive && facts.work.eligible,
    canPostCoverage: isHost && spActive,
    canManageApplicants: isHost && spActive,
    canManageClassTemplates: isHost && spActive,
    canUseRoster: isHost && spActive,
    practitionerProActive: proActive,
    foundingProFreeUntil:
      inProFree && facts.foundingPractitionerAt
        ? foundingPractitionerFreeUntil(facts.foundingPractitionerAt)
        : null,
    foundingProDiscount: hasFoundingPractitionerDiscount(facts.foundingPractitionerAt),
    studioProActive: spActive,
    foundingFreeUntil:
      inHostFree && facts.foundingHostAt ? foundingHostFreeUntil(facts.foundingHostAt) : null,
    foundingStudioDiscount: hasFoundingStudioDiscount(facts.foundingHostAt),
  };
}
