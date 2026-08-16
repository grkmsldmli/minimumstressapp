/**
 * The first time each thing happens, said out loud.
 *
 * badges.ts starts at a hundred sessions. For a studio taking two bookings a
 * week that is a year away, and the badge card renders nothing at all below
 * twenty-five — so a host publishes a listing, lets a stranger into their
 * building, holds a session, reads their first review, and the app says
 * nothing to them for a year. The stretch that decides whether somebody stays
 * is the one with no acknowledgement in it.
 *
 * These are moments, not progress. No bar, no percentage, no "96 to go". Each
 * one either happened or has not, and the one that matters most — the first
 * session — is worth interrupting somebody for.
 *
 * Recognition only, and that is a deliberate line rather than a first version.
 * badges.ts records what happened when tiers carried real benefits: a longer
 * window, a waived fee, a faster payout. Every one became a rule to reason
 * about while somebody was trying to book a space, and none of them made the
 * marketplace work better. Nothing here changes a price, a limit or a queue
 * position.
 *
 * ## Why the two sides are not the same
 *
 * Symmetry in shape, not in content. A host's payoff is money arriving; a
 * practitioner's outlay is money leaving, and congratulating somebody on
 * having spent two thousand dollars is a reminder of a bill. So the running
 * total differs: the host counts what empty hours earned, the practitioner
 * counts the practice they have held.
 *
 * The practitioner's equivalent of a first payout is the first time they book
 * the same space twice. That is when somebody stops shopping and starts having
 * a routine — the behaviour rebook.ts was built around and the one Pro sells.
 */

export type Party = "host" | "practitioner";

/** Ordered as they happen. The key is stored, so these strings are permanent. */
export type MilestoneKey =
  | "host_listed"
  | "host_first_booking"
  | "host_first_session"
  | "host_first_review"
  | "host_first_payout"
  | "host_ten_sessions"
  | "pro_first_booking"
  | "pro_first_session"
  | "pro_first_review"
  | "pro_first_repeat"
  | "pro_ten_sessions";

export interface Milestone {
  key: MilestoneKey;
  party: Party;
  /** The moment, named as a thing that happened rather than a level reached. */
  title: string;
  /** One line, second person, about what it means. Never a number alone. */
  meaning: string;
  /**
   * Whether reaching it takes over the screen.
   *
   * Exactly one per side. If everything is a celebration then nothing is, and
   * the first session is the one where something actually happened: a stranger
   * came, the space worked, nothing broke.
   */
  celebrate: boolean;
}

export const MILESTONES: readonly Milestone[] = [
  {
    key: "host_listed",
    party: "host",
    title: "Your space is live",
    meaning: "It is on the map. Practitioners can find it now.",
    celebrate: false,
  },
  {
    key: "host_first_booking",
    party: "host",
    title: "Somebody chose your space",
    meaning: "Out of everything they could have booked, they picked yours.",
    celebrate: false,
  },
  {
    key: "host_first_session",
    party: "host",
    title: "Your first session happened",
    meaning: "Somebody worked in your space, and the hour paid for itself.",
    celebrate: true,
  },
  {
    key: "host_first_review",
    party: "host",
    title: "Your first review",
    meaning: "Somebody wrote down what it was like to work there.",
    celebrate: false,
  },
  {
    /*
     * The strongest moment in the whole arc and the one nothing marked.
     * A listing is a hope and a session is an experience; money landing is the
     * proof, and it is the point at which somebody decides this is real.
     */
    key: "host_first_payout",
    party: "host",
    title: "Your first payout landed",
    meaning: "An hour you were not using turned into money in your account.",
    celebrate: false,
  },
  {
    key: "host_ten_sessions",
    party: "host",
    title: "Ten sessions hosted",
    meaning: "Not luck any more. Your space is part of how people work.",
    celebrate: false,
  },

  {
    key: "pro_first_booking",
    party: "practitioner",
    title: "Your first space is booked",
    meaning: "An hour is yours, and nobody else can take it.",
    celebrate: false,
  },
  {
    key: "pro_first_session",
    party: "practitioner",
    title: "You held your first session",
    meaning: "No lease, and the space was ready for you.",
    celebrate: true,
  },
  {
    key: "pro_first_review",
    party: "practitioner",
    title: "Your first review",
    meaning: "A host wrote down what it was like to have you there.",
    celebrate: false,
  },
  {
    /*
     * A practitioner's own version of the payout: the moment they stop
     * searching. Going back to the same space is the difference between finding
     * space and having a place to work.
     */
    key: "pro_first_repeat",
    party: "practitioner",
    title: "You went back",
    meaning: "The same space, twice. That is a routine, not a search.",
    celebrate: false,
  },
  {
    key: "pro_ten_sessions",
    party: "practitioner",
    title: "Ten sessions held",
    meaning: "Ten hours of work, in spaces you never had to lease.",
    celebrate: false,
  },
];

/** What the app knows about somebody, counted from rows that already exist. */
export interface HostFacts {
  liveListings: number;
  bookingsReceived: number;
  sessionsHosted: number;
  reviewsReceived: number;
  payoutsReceived: number;
  /** The host's own rate, summed over sessions that happened. Never the total. */
  earnedCents: number;
}

export interface PractitionerFacts {
  bookingsMade: number;
  sessionsHeld: number;
  reviewsReceived: number;
  /** How many distinct rooms have been used more than once. */
  roomsReturnedTo: number;
  /** Distinct rooms used at all, which is the other half of the sentence. */
  roomsUsed: number;
}

const HOST_RULES: Record<string, (f: HostFacts) => boolean> = {
  host_listed: (f) => f.liveListings >= 1,
  host_first_booking: (f) => f.bookingsReceived >= 1,
  host_first_session: (f) => f.sessionsHosted >= 1,
  host_first_review: (f) => f.reviewsReceived >= 1,
  host_first_payout: (f) => f.payoutsReceived >= 1,
  host_ten_sessions: (f) => f.sessionsHosted >= 10,
};

const PRACTITIONER_RULES: Record<string, (f: PractitionerFacts) => boolean> = {
  pro_first_booking: (f) => f.bookingsMade >= 1,
  pro_first_session: (f) => f.sessionsHeld >= 1,
  pro_first_review: (f) => f.reviewsReceived >= 1,
  pro_first_repeat: (f) => f.roomsReturnedTo >= 1,
  pro_ten_sessions: (f) => f.sessionsHeld >= 10,
};

export function earnedByHost(facts: HostFacts): MilestoneKey[] {
  return MILESTONES.filter((m) => m.party === "host" && HOST_RULES[m.key](facts)).map((m) => m.key);
}

export function earnedByPractitioner(facts: PractitionerFacts): MilestoneKey[] {
  return MILESTONES.filter(
    (m) => m.party === "practitioner" && PRACTITIONER_RULES[m.key](facts),
  ).map((m) => m.key);
}

export function milestone(key: MilestoneKey): Milestone {
  const found = MILESTONES.find((m) => m.key === key);
  if (!found) throw new RangeError(`unknown milestone: ${key}`);
  return found;
}

/**
 * The one to interrupt somebody with, if any.
 *
 * Earned, not yet acknowledged, and marked as worth a full screen. Returns the
 * first such — there is only ever one per side, but a returning user who
 * crossed several at once should still meet them one at a time rather than in
 * a stack.
 */
export function celebrationDue(
  earned: readonly MilestoneKey[],
  acknowledged: readonly string[],
): Milestone | null {
  const seen = new Set(acknowledged);
  const due = earned.find((key) => !seen.has(key) && milestone(key).celebrate);
  return due ? milestone(due) : null;
}

/**
 * What the running total says, which is not the same sentence on both sides.
 *
 * The host is told what unused hours earned, because that is what they came
 * for. The practitioner is told what they have held, because telling somebody
 * how much they have spent is showing them a bill.
 */
export function hostTotal(facts: HostFacts): string | null {
  if (facts.sessionsHosted === 0) return null;

  const dollars = Math.round(facts.earnedCents / 100).toLocaleString("en-US");
  const hours = facts.sessionsHosted === 1 ? "1 hour" : `${facts.sessionsHosted} hours`;
  return `${hours} you were not using, turned into $${dollars}.`;
}

export function practitionerTotal(facts: PractitionerFacts): string | null {
  if (facts.sessionsHeld === 0) return null;

  const sessions = facts.sessionsHeld === 1 ? "1 session" : `${facts.sessionsHeld} sessions`;
  const rooms = facts.roomsUsed === 1 ? "1 room" : `${facts.roomsUsed} rooms`;
  return `${sessions} held, in ${rooms}.`;
}
