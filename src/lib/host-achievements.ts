/**
 * Host achievements — the milestones a host passes as real sessions run.
 *
 * One ladder, counted from sessions that actually happened and were paid for.
 * "Happened and paid for" is not decided here: it is `hostFactsFrom`'s
 * `sessionsHosted`, which counts a booking only when its status is 'completed'
 * and the money was captured — the same truth `host_bookings()` returns and the
 * same truth the practitioner-facing milestone in `public_host_profiles` reads.
 * Nothing in this file re-interprets a booking; it is arithmetic over a count
 * somebody else has already made honest.
 *
 * A milestone is recognition and nothing else — no fee changes, no rule bends,
 * the same choice `lib/badges` and `lib/milestones` already made. It is earned
 * the moment the count reaches it and never lost, because the count it is read
 * from only ever describes sessions that did happen.
 *
 * The thresholds here are the source; the buckets in the `public_host_profiles`
 * view (migration 0060) are pinned to them by host-achievements-sql-sync.test.
 */

export interface SessionMilestone {
  /** Completed, paid sessions needed to earn it. */
  at: number;
  /** What it is called, in the app's own calm register. */
  label: string;
}

/**
 * First Booking, then a ladder that keeps meaning something.
 *
 * The first is the moment a room becomes a working room; the rest are spaced so
 * each is a real stretch of practice rather than a number that ticks over every
 * few weeks. A thousand sessions is years of a room people rely on.
 */
export const SESSION_MILESTONES: readonly SessionMilestone[] = [
  { at: 1, label: "First Booking" },
  { at: 10, label: "10 Sessions" },
  { at: 50, label: "50 Sessions" },
  { at: 100, label: "100 Sessions" },
  { at: 250, label: "250 Sessions" },
  { at: 500, label: "500 Sessions" },
  { at: 1000, label: "1,000 Sessions" },
];

/** The thresholds alone, ascending — what the SQL buckets are pinned against. */
export const SESSION_MILESTONE_THRESHOLDS: readonly number[] = SESSION_MILESTONES.map(
  (m) => m.at,
);

export interface HostAchievementProgress {
  /** Completed, paid sessions hosted — the number every field below is read from. */
  completed: number;
  /** The highest milestone reached, or null before the first session. */
  earned: SessionMilestone | null;
  /** The next one to reach, or null once the top of the ladder is earned. */
  next: SessionMilestone | null;
  /** Sessions still needed for `next`, or null when there is no next. */
  toNext: number | null;
}

/**
 * Where a host stands on the ladder, from their completed-session count.
 *
 * The count is the only input, and it is the server's — a host cannot hand this
 * a number of their own. Zero returns a calm "nothing earned yet, First Booking
 * ahead" rather than an empty shape the caller has to special-case.
 */
export function hostAchievementProgress(completed: number): HostAchievementProgress {
  const earned = [...SESSION_MILESTONES].reverse().find((m) => completed >= m.at) ?? null;
  const next = SESSION_MILESTONES.find((m) => m.at > completed) ?? null;

  return {
    completed,
    earned,
    next,
    toNext: next ? next.at - completed : null,
  };
}

/** The highest milestone reached by a completed-session count, or null. */
export function highestSessionMilestone(completed: number): SessionMilestone | null {
  return hostAchievementProgress(completed).earned;
}

/**
 * The label for a bucketed milestone value from `public_host_profiles`.
 *
 * The view exposes the threshold reached (0/1/10/…/1000), never the exact
 * count, so a practitioner-facing surface turns that bucket into words without
 * ever holding a host's precise volume. 0, or an unknown bucket, is null —
 * "nothing to show", which reads as no badge at all.
 */
export function sessionMilestoneLabel(bucket: number): string | null {
  return SESSION_MILESTONES.find((m) => m.at === bucket)?.label ?? null;
}
