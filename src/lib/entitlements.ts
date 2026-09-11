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
 * Studio Pro is active either through a paid/trialing Stripe subscription OR
 * through a Founding Host's automatic free period — which is DERIVED here, never
 * a Stripe trial, because a Founding Host is given it with no card and no
 * auto-created subscription.
 */

import type { AccountType } from "./domain";
import { FOUNDING_HOST_FREE_MONTHS, STUDIO_PRO_LAUNCHED_AT } from "./money";
import type { WorkEligibility } from "./work/eligibility";

/**
 * The end of a Founding Host's free Studio Pro period.
 *
 * Measured from max(founding_host_at, launch) so a host who earned Founding
 * before Studio Pro existed still gets the full six months from launch, and a
 * host who earns it later gets six months from their award. No fabricated
 * timestamps — founding_host_at is server-written and backfilled (migration 0060).
 */
export function foundingHostFreeUntil(foundingHostAt: Date): Date {
  const start =
    foundingHostAt.getTime() > STUDIO_PRO_LAUNCHED_AT.getTime()
      ? foundingHostAt
      : STUDIO_PRO_LAUNCHED_AT;
  const until = new Date(start.getTime());
  until.setUTCMonth(until.getUTCMonth() + FOUNDING_HOST_FREE_MONTHS);
  return until;
}

/** True while a Founding Host is inside their free six months. */
export function withinFoundingFreePeriod(foundingHostAt: Date | null, now: Date): boolean {
  if (!foundingHostAt) return false;
  return now.getTime() < foundingHostFreeUntil(foundingHostAt).getTime();
}

export interface EntitlementFacts {
  accountType: AccountType | null;
  /** Practitioner Pro (profiles.is_pro), webhook-written. */
  isPro: boolean;
  /** A paid/trialing Studio Pro Stripe subscription (profiles.studio_pro), webhook-written. */
  studioProSubscription: boolean;
  /** When this host became a Founding Host, or null. Drives the free period + discount. */
  foundingHostAt: Date | null;
  /** The verification gate (workEligibility) — only meaningful for a practitioner. */
  work: WorkEligibility;
  now: Date;
}

/** Studio Pro active = a live Stripe subscription OR the Founding free period. */
export function isStudioProActive(facts: EntitlementFacts): boolean {
  return facts.studioProSubscription || withinFoundingFreePeriod(facts.foundingHostAt, facts.now);
}

/** Whether a host has the permanent Founding-Host right to Studio Pro at 50% off. */
export function hasFoundingStudioDiscount(foundingHostAt: Date | null): boolean {
  return foundingHostAt !== null;
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
  /** Studio Pro is active (paid or founding free) — drives the PRO badge. */
  studioProActive: boolean;
  /** The end of the founding free period, when the host is in one (for reminders). */
  foundingFreeUntil: Date | null;
  /** This host holds the permanent Founding 50%-off right. */
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
  const inFree = withinFoundingFreePeriod(facts.foundingHostAt, facts.now);

  return {
    canBrowseWork: isPractitioner && facts.isPro,
    canApplyToWork: isPractitioner && facts.isPro && facts.work.eligible,
    canPostCoverage: isHost && spActive,
    canManageApplicants: isHost && spActive,
    canManageClassTemplates: isHost && spActive,
    canUseRoster: isHost && spActive,
    studioProActive: spActive,
    foundingFreeUntil: inFree && facts.foundingHostAt ? foundingHostFreeUntil(facts.foundingHostAt) : null,
    foundingStudioDiscount: hasFoundingStudioDiscount(facts.foundingHostAt),
  };
}
