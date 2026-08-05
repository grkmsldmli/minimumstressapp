import type { Rating } from "./reviews";

/**
 * Points, tiers, and the reasons behind both.
 *
 * Derived from things that already happened — a session completed, a review
 * arrived, a cancellation counted — rather than stored as a second number to
 * keep in step with the first. A points balance that can drift from the events
 * that produced it is a balance somebody will eventually dispute, and there is
 * no way to settle the argument.
 *
 * Two rules shaped everything here.
 *
 * **It has to be unfarmable.** A host who can book their own room, or two
 * accounts that can book each other in a loop, would reach any tier in an
 * afternoon — and a tier that can be bought with an afternoon is worth nothing
 * to the person who spent a year earning it. So a session only counts when
 * money actually moved between two different people.
 *
 * **It must not punish being new.** Somebody with three sessions is not
 * untrustworthy, they are new, and a score that starts at zero and is displayed
 * next to somebody at four hundred says the wrong thing. Tiers name a stage
 * rather than rank people against each other.
 */

export type Party = "practitioner" | "host";

/**
 * What a completed session is worth.
 *
 * The base is deliberately the largest component: showing up is the behaviour
 * the marketplace actually needs, and a scheme where reviews outweigh sessions
 * rewards being liked over being reliable.
 */
export const POINTS = {
  /**
   * A session that happened and was paid for.
   *
   * Deliberately worth more than the best possible review. At ten it tied with
   * five stars, which made being liked exactly as valuable as showing up — the
   * thing this comment claims to avoid, sitting in the numbers directly
   * underneath it. A test caught the contradiction; the value was wrong, not
   * the principle.
   */
  completedSession: 15,

  /** Per star, on a review the other side left. Five stars is worth ten. */
  perReviewStar: 2,

  /**
   * A session where nothing went wrong on your side — no late cancellation,
   * no safety concern raised against you. Small, and it adds up.
   */
  cleanSession: 2,

  /**
   * A late cancellation. Negative, and larger than a session is worth: one
   * broken commitment costs more than one kept one earns, because that is the
   * actual asymmetry — somebody was left without a room.
   */
  lateCancellation: -25,

  /** A safety concern upheld against you. Larger still, for obvious reasons. */
  upheldSafetyConcern: -100,
} as const;

export interface Tier {
  key: string;
  name: string;
  /** Points needed to reach it. */
  at: number;
  /** What it actually gets you. A tier with no benefit is a sticker. */
  benefit: string;
}

/**
 * Four tiers, and each one does something.
 *
 * A ladder of names with nothing attached is a leaderboard, and a leaderboard
 * between people who need each other is a bad idea — it makes a practitioner
 * with fewer sessions look like a worse bet to a host reading the same screen.
 * Every tier below changes something real about how the app treats you.
 */
export const TIERS: Record<Party, Tier[]> = {
  practitioner: [
    {
      key: "new",
      name: "New here",
      at: 0,
      benefit: "Everything works from day one. Nothing is held back while you build a history.",
    },
    {
      key: "established",
      name: "Established",
      at: 100,
      benefit: "Your booking window opens 5 days ahead instead of same-day.",
    },
    {
      key: "trusted",
      name: "Trusted",
      at: 300,
      benefit: "Instant-booking fees waived on two sessions a month.",
    },
    {
      key: "resident",
      name: "Resident",
      at: 750,
      benefit: "A 5% credit back on every session, and first refusal on newly listed rooms.",
    },
  ],
  host: [
    {
      key: "new",
      name: "New here",
      at: 0,
      benefit: "Your listing is shown the same as everybody else's while you build a history.",
    },
    {
      key: "established",
      name: "Established",
      at: 100,
      benefit: "Payouts arrive one business day sooner.",
    },
    {
      key: "trusted",
      name: "Trusted",
      at: 300,
      benefit: "A Trusted mark on your listing, and priority in the review queue for new rooms.",
    },
    {
      key: "resident",
      name: "Resident",
      at: 750,
      benefit: "Instant payouts at no fee, and your rooms surface first for nearby practitioners.",
    },
  ],
};

/** One thing that happened, and what it was worth. */
export interface PointEvent {
  kind: keyof typeof POINTS;
  at: Date;
  /** Only for review stars. */
  stars?: Rating;
}

/**
 * Sessions that count.
 *
 * The two ids must differ. Without this, a host with a second account books
 * their own room, both accounts collect, and no money has left the pair — the
 * platform fee comes back as points on both sides. It is the cheapest possible
 * attack and it invalidates every number on the screen.
 */
export function countsTowardPoints(session: {
  practitionerId: string;
  hostId: string;
  status: string;
  capturedAt: Date | null;
}): boolean {
  if (session.practitionerId === session.hostId) return false;
  if (session.status !== "completed") return false;
  // Captured means money actually moved. A booking that was never charged is
  // not a session, whatever its status says.
  return session.capturedAt !== null;
}

export function pointsFor(event: PointEvent): number {
  if (event.kind === "perReviewStar") {
    return POINTS.perReviewStar * (event.stars ?? 0);
  }
  return POINTS[event.kind];
}

/**
 * The total, floored at zero.
 *
 * A negative score is a punishment that keeps punishing: somebody who cancelled
 * twice would need four clean sessions to get back to nothing, and the number
 * they see meanwhile tells them not to bother. Suspension is how repeated
 * cancellation is actually handled — that lives in reliability.ts and has real
 * teeth. This is the encouraging number, and it should not double as a second
 * penalty.
 */
export function totalPoints(events: PointEvent[]): number {
  return Math.max(
    0,
    events.reduce((sum, event) => sum + pointsFor(event), 0),
  );
}

export interface Standing {
  points: number;
  tier: Tier;
  /** Null at the top. */
  next: Tier | null;
  /** Points still needed. Zero at the top. */
  toNext: number;
  /** 0–1 through the current tier, for a progress bar. */
  progress: number;
}

export function standingFor(party: Party, points: number): Standing {
  const ladder = TIERS[party];

  // The highest tier whose threshold has been passed.
  const tier = [...ladder].reverse().find((t) => points >= t.at) ?? ladder[0];
  const next = ladder.find((t) => t.at > points) ?? null;

  if (!next) {
    return { points, tier, next: null, toNext: 0, progress: 1 };
  }

  const span = next.at - tier.at;
  return {
    points,
    tier,
    next,
    toNext: next.at - points,
    // Guarded: two tiers at the same threshold would divide by zero, and a
    // misconfigured ladder should not render NaN on somebody's profile.
    progress: span > 0 ? Math.min(1, Math.max(0, (points - tier.at) / span)) : 1,
  };
}

/** Whether a tier's benefit is live for this account. */
export function hasBenefit(party: Party, points: number, tierKey: string): boolean {
  const tier = TIERS[party].find((t) => t.key === tierKey);
  return tier ? points >= tier.at : false;
}
