/**
 * Badges, earned by turning up.
 *
 * This replaced a points-and-tiers system that gave real benefits — a longer
 * booking window, a waived fee, a faster payout. Every one of those was a rule
 * that had to be explained, tested, and reasoned about at the moment somebody
 * was trying to book a room, and none of them made the marketplace work
 * better. A badge is recognition and nothing else: no pricing changes, no rules
 * bend, nothing to reconcile.
 *
 * Counted from sessions that actually happened between two different people —
 * a host booking their own room proves nothing, and a badge that can be
 * manufactured in an afternoon is worth nothing to somebody who spent a year
 * earning it.
 */

export type Party = "practitioner" | "host";

export interface Badge {
  key: string;
  /** What the badge is called. Shown on a profile. */
  name: string;
  /** Sessions needed. */
  at: number;
  /** One line, in the second person, about what it means. */
  meaning: string;
}

/**
 * Three, spaced so each one takes real time.
 *
 * A hundred sessions is a year of weekly practice; five hundred is a career in
 * this room. Closer together and they stop meaning anything, further apart and
 * only the earliest is ever reachable.
 */
export const BADGES: Record<Party, Badge[]> = {
  practitioner: [
    { key: "hundred", name: "100 sessions", at: 100, meaning: "A hundred hours of practice booked and held." },
    { key: "twofifty", name: "250 sessions", at: 250, meaning: "Two hundred and fifty. Studios know your name by now." },
    { key: "fivehundred", name: "500 sessions", at: 500, meaning: "Five hundred sessions. This is a practice, not a hobby." },
  ],
  host: [
    { key: "hundred", name: "100 sessions hosted", at: 100, meaning: "A hundred sessions have run in your room." },
    { key: "twofifty", name: "250 sessions hosted", at: 250, meaning: "Two hundred and fifty. Your hours are somebody's routine." },
    { key: "fivehundred", name: "500 sessions hosted", at: 500, meaning: "Five hundred. A room a lot of people count on." },
  ],
};

/** Whether a session counts. The two ids must differ — see the note above. */
export function countsTowardBadges(session: {
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

export interface BadgeProgress {
  sessions: number;
  earned: Badge[];
  /** The next one to aim at, or null once they are all earned. */
  next: Badge | null;
  /** Sessions still needed for `next`. Zero when there is no next. */
  toNext: number;
}

export function badgesFor(party: Party, sessions: number): BadgeProgress {
  const ladder = BADGES[party];
  const earned = ladder.filter((badge) => sessions >= badge.at);
  const next = ladder.find((badge) => badge.at > sessions) ?? null;

  return {
    sessions,
    earned,
    next,
    toNext: next ? next.at - sessions : 0,
  };
}
