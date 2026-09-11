/**
 * Deterministic matching between a coverage request and a practitioner.
 *
 * No "AI", no opaque score: a set of hard filters that either pass or do not,
 * then a plain, explainable rank over signals already trusted elsewhere
 * (distance, reputation, standing). Pure and DB-free so it can be tested
 * exhaustively and reused unchanged by the server (which supplies the facts from
 * the admin client) — the same discipline as `planBooking`.
 *
 * Time is handled the only safe way (lib/timezone): a request's absolute window
 * is read on the PRACTITIONER's own wall clock before it is compared to their
 * weekly blocks, so a 7pm Pacific class is matched against the 7pm block a New
 * York practitioner set, not 10pm. Never `Date` field access for scheduling.
 */

import { type AvailabilityBlock, blocksForDay } from "../availability";
import { MAX_NEARBY_MILES, distanceBetween } from "../distance";
import type { LatLng } from "../geo";
import { checkInsuranceForBooking } from "../insurance";
import { civilIn, minuteOfDayIn, weekdayOf } from "../timezone";
import { type WorkEligibilityFacts, workEligibility } from "./eligibility";
import { professionCovers } from "./modality-match";

/**
 * Does a practitioner's recurring weekly availability (wall-clock in their own
 * zone) fully contain an absolute [start, end) window? Both endpoints are read
 * on the practitioner's clock, never off Date fields.
 */
export function coversWindow(
  blocks: readonly AvailabilityBlock[],
  practitionerZone: string,
  start: Date,
  end: Date,
): boolean {
  const startDay = civilIn(start, practitionerZone);
  const endDay = civilIn(end, practitionerZone);
  // A block is single-day; a window crossing midnight in the practitioner's zone
  // cannot sit inside one block. Reject rather than half-match.
  if (
    startDay.year !== endDay.year ||
    startDay.month !== endDay.month ||
    startDay.day !== endDay.day
  ) {
    return false;
  }
  const startMin = minuteOfDayIn(start, practitionerZone);
  const endMin = minuteOfDayIn(end, practitionerZone);
  const weekday = weekdayOf(startDay);
  return blocksForDay(blocks, weekday).some(
    (b) => b.startMinute <= startMin && b.endMinute >= endMin,
  );
}

/** Everything the matcher needs about one candidate, from stored columns. */
export interface CandidateFacts {
  practitionerId: string;
  availableForWork: boolean;
  profession: string | null;
  /** The wall-clock zone their availability blocks are written in. */
  workZone: string;
  availability: readonly AvailabilityBlock[];
  /** Optional home point for distance; null when they have not set one. */
  base: LatLng | null;
  /** Their own travel ceiling in miles, or null for the platform default. */
  maxTravelMiles: number | null;
  /** Their pay floor in cents, or null for no floor. */
  minPayCents: number | null;
  /** Ranking signals — already-blessed, coarse reputation. */
  completedSessions: number;
  goodStanding: boolean;
  /** The person-level booking gate. */
  eligibility: WorkEligibilityFacts;
}

/** What the matcher needs about the request. */
export interface RequestFacts {
  hostId: string;
  profession: string | null;
  startsAt: Date;
  endsAt: Date;
  payCents: number;
  /** The room's real coordinates (server-side only), or null. */
  space: LatLng | null;
}

/** Why a candidate did not match — for tests and server logging, never shown. */
export type MatchMiss =
  | "not_available"
  | "self"
  | "ineligible"
  | "insurance_window"
  | "modality"
  | "availability"
  | "too_far"
  | "below_pay";

export interface MatchResult {
  matches: boolean;
  misses: MatchMiss[];
  /** Higher is better. Only meaningful when `matches` is true. */
  score: number;
  /** Miles between the two points, or null when either is unknown. */
  distanceMiles: number | null;
}

/**
 * The whole decision for one candidate against one request. Hard filters first;
 * a candidate that clears them all gets a deterministic score.
 */
export function matchCandidate(
  request: RequestFacts,
  candidate: CandidateFacts,
  now: Date = new Date(),
): MatchResult {
  const misses: MatchMiss[] = [];

  if (!candidate.availableForWork) misses.push("not_available");
  // A host and a practitioner are different accounts, but guard anyway so a
  // request can never surface its own poster (the "no self-match" rule).
  if (candidate.practitionerId === request.hostId) misses.push("self");
  if (!workEligibility(candidate.eligibility, now).eligible) misses.push("ineligible");
  // Date-accurate cover for THIS window — a policy that lapses before the class
  // excludes the candidate from it even though they are eligible in general.
  if (checkInsuranceForBooking(candidate.eligibility.insurance, request.startsAt, request.endsAt, now)) {
    misses.push("insurance_window");
  }
  if (!professionCovers(request.profession, candidate.profession)) misses.push("modality");
  if (!coversWindow(candidate.availability, candidate.workZone, request.startsAt, request.endsAt)) {
    misses.push("availability");
  }

  let distanceMiles: number | null = null;
  if (candidate.base && request.space) {
    distanceMiles = distanceBetween(candidate.base, request.space, "mi");
    // Their own ceiling, but never beyond the platform's nearby horizon.
    const cap = Math.min(candidate.maxTravelMiles ?? MAX_NEARBY_MILES, MAX_NEARBY_MILES);
    if (distanceMiles > cap) misses.push("too_far");
  }

  if (candidate.minPayCents != null && request.payCents < candidate.minPayCents) {
    misses.push("below_pay");
  }

  const matches = misses.length === 0;

  // Deterministic rank: closer is better (unknown distance sits neutral, never
  // last-by-default), more completed sessions helps, good standing nudges up.
  let score = 0;
  score += distanceMiles == null ? 40 : Math.max(0, 60 - distanceMiles);
  score += Math.min(50, candidate.completedSessions);
  if (candidate.goodStanding) score += 10;

  return { matches, misses, score, distanceMiles };
}

/**
 * Rank the matching candidates for a request, best first. Ties break on more
 * completed sessions, then on id so the order is stable.
 */
export function rankCandidates(
  request: RequestFacts,
  candidates: readonly CandidateFacts[],
  now: Date = new Date(),
): { candidate: CandidateFacts; result: MatchResult }[] {
  return candidates
    .map((candidate) => ({ candidate, result: matchCandidate(request, candidate, now) }))
    .filter((c) => c.result.matches)
    .sort(
      (a, b) =>
        b.result.score - a.result.score ||
        b.candidate.completedSessions - a.candidate.completedSessions ||
        a.candidate.practitionerId.localeCompare(b.candidate.practitionerId),
    );
}
