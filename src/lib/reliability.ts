/**
 * Standing: what repeated last-minute cancellations cost someone.
 *
 * The point is to stop people being let down, not to punish. Two things follow
 * from that and shape everything below.
 *
 * **The two sides do not cause the same harm.** A practitioner who cancels
 * inside 24 hours is charged in full — the host keeps the money for an hour
 * they had set aside, so the loss is already settled between them. A host who
 * cancels leaves a practitioner with no room, sometimes with their own client
 * already booked, and no amount of goodwill credit gives them the session
 * back. Treating both with one threshold would either wave through the harmful
 * case or punish the settled one. So hosts escalate at three, practitioners at
 * six.
 *
 * **A suspension must not create the harm it prevents.** It stops new
 * bookings only. Every booking already on the calendar is honoured, because
 * cancelling them to punish someone would land on a third party who did
 * nothing — the exact thing this policy exists to prevent.
 *
 * It is also time-boxed rather than permanent, published rather than secret,
 * and visible to the person it applies to before it applies. Someone should be
 * able to see they are one cancellation away, and a livelihood should not end
 * on an automatic rule with nobody to ask.
 */

/** Cancellations older than this stop counting. */
export const STANDING_WINDOW_DAYS = 90;

/** How long a suspension lasts before it lifts on its own. */
export const SUSPENSION_DAYS = 14;

/**
 * A cancellation counts as late when it lands inside the free-cancellation
 * window — the same 24-hour line the refund policy uses, so there is one
 * boundary to explain rather than two.
 */
export const LATE_CANCELLATION_HOURS = 24;

export type Party = "host" | "practitioner";

export const THRESHOLDS: Record<Party, { warnAt: number; suspendAt: number }> = {
  // A host cancellation is the one nothing makes right.
  host: { warnAt: 2, suspendAt: 3 },
  // A practitioner's is already paid for, so this catches a pattern rather
  // than a loss — hence the higher bar.
  practitioner: { warnAt: 4, suspendAt: 6 },
};

export interface CancellationEvent {
  /** When the cancellation happened. */
  at: Date;
  /** When the session would have started. */
  sessionStart: Date;
  /** Which side walked away. */
  by: Party;
}

export type StandingLevel = "clear" | "warned" | "suspended";

export interface Standing {
  level: StandingLevel;
  /** Late cancellations inside the window. */
  lateCancellations: number;
  /** How many more before the next consequence. Null once suspended. */
  remainingBeforeSuspension: number | null;
  /** When a suspension lifts, if there is one. */
  suspendedUntil: Date | null;
  /** True when new bookings are blocked. Existing ones are never touched. */
  blocksNewBookings: boolean;
}

/** Was this cancellation inside the 24-hour window? */
export function isLate(event: CancellationEvent): boolean {
  const hoursAhead = (event.sessionStart.getTime() - event.at.getTime()) / 3_600_000;
  return hoursAhead < LATE_CANCELLATION_HOURS;
}

/**
 * Work out where someone stands from their actual history.
 *
 * Derived rather than stored, so it can never drift from the bookings it
 * describes, and so a cancellation ageing out of the window restores someone
 * automatically without anyone remembering to.
 *
 * `reinstatedAt` is the appeal: staff lifting a suspension sets it, and
 * anything before that stops counting. An automatic rule with no way to be
 * heard is not a policy, it is a trapdoor.
 */
export function standingFor(
  party: Party,
  history: readonly CancellationEvent[],
  now: Date,
  reinstatedAt: Date | null = null,
): Standing {
  const windowStart = new Date(now.getTime() - STANDING_WINDOW_DAYS * 86_400_000);
  const countFrom =
    reinstatedAt && reinstatedAt > windowStart ? reinstatedAt : windowStart;

  const relevant = history
    .filter((event) => event.by === party)
    .filter((event) => event.at > countFrom && event.at <= now)
    .filter(isLate)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const { warnAt, suspendAt } = THRESHOLDS[party];
  const count = relevant.length;

  if (count >= suspendAt) {
    // Counted from the cancellation that crossed the line, so the clock starts
    // at the act rather than at whenever someone next looks.
    const trigger = relevant[suspendAt - 1].at;
    const until = new Date(trigger.getTime() + SUSPENSION_DAYS * 86_400_000);

    if (until > now) {
      return {
        level: "suspended",
        lateCancellations: count,
        remainingBeforeSuspension: null,
        suspendedUntil: until,
        blocksNewBookings: true,
      };
    }
    // Served. They are back, though the cancellations still count until they
    // age out — which is why the level below may still be a warning.
  }

  return {
    level: count >= warnAt ? "warned" : "clear",
    lateCancellations: count,
    remainingBeforeSuspension: Math.max(0, suspendAt - count),
    suspendedUntil: null,
    blocksNewBookings: false,
  };
}

/**
 * What to tell the person it applies to.
 *
 * Written second-person and without euphemism. Someone who is one cancellation
 * from losing bookings should be told that plainly, while they can still do
 * something about it.
 */
export function explainStanding(party: Party, standing: Standing): string {
  const { suspendAt } = THRESHOLDS[party];
  const noun = party === "host" ? "bookings on your spaces" : "new bookings";

  switch (standing.level) {
    case "suspended":
      return `You can't take ${noun} until ${standing.suspendedUntil!.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, after ${standing.lateCancellations} last-minute cancellations in ${STANDING_WINDOW_DAYS} days. Sessions already booked are unaffected and still go ahead. If something here is wrong, get in touch — we'd rather hear it.`;

    case "warned":
      return `${standing.lateCancellations} last-minute cancellations in the past ${STANDING_WINDOW_DAYS} days. ${standing.remainingBeforeSuspension === 1 ? "One more" : `${standing.remainingBeforeSuspension} more`} and you won't be able to take ${noun} for ${SUSPENSION_DAYS} days. Cancellations stop counting after ${STANDING_WINDOW_DAYS} days.`;

    case "clear":
      return standing.lateCancellations === 0
        ? "No last-minute cancellations. Thank you — people plan their day around these."
        : `${standing.lateCancellations} last-minute cancellation${standing.lateCancellations === 1 ? "" : "s"} in the past ${STANDING_WINDOW_DAYS} days. ${suspendAt} would pause your bookings for ${SUSPENSION_DAYS} days.`;
  }
}
