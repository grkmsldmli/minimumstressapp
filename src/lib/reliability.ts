import { SUPPORT_EMAIL } from "./company";
import { FREE_CANCEL_WINDOW_MS } from "./money";

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
 * back. Both sides pause at the same count — three late cancellations inside
 * the window — but the length of the pause is where they differ: a host's runs
 * the full term, a practitioner's half of it, because a practitioner's late
 * cancellation is already paid for. One count keeps the rule simple to state;
 * the shorter pause keeps it proportionate to a harm that money already settled.
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

/**
 * A cancellation counts as late when it lands inside the free-cancellation
 * window — the same line the refund policy uses, so there is one boundary to
 * explain rather than two.
 *
 * Derived rather than restated. It used to be its own `24`, sitting beside
 * money.ts's own `24`, with a comment claiming they were the same line. They
 * were only the same number: changing one would have left the app charging
 * for a cancellation it did not count, or counting one it did not charge for,
 * and nothing would have failed.
 */
export const LATE_CANCELLATION_HOURS = FREE_CANCEL_WINDOW_MS / (60 * 60 * 1000);

export type Party = "host" | "practitioner";

/**
 * How long a pause lasts before it lifts on its own, per side.
 *
 * The same count triggers it on both sides; the length is what differs. A
 * host's cancellation is the one nothing makes right, so it costs the full
 * term. A practitioner's is already paid for — the host keeps the hour's fee —
 * so the pause is a proportionate nudge, half as long, not a second penalty on
 * top of a settled one.
 */
export const SUSPENSION_DAYS: Record<Party, number> = {
  host: 14,
  practitioner: 7,
};

export const THRESHOLDS: Record<Party, { warnAt: number; suspendAt: number }> = {
  // A host cancellation is the one nothing makes right.
  host: { warnAt: 2, suspendAt: 3 },
  // The same count as a host for launch — simple to state and to see coming —
  // with a shorter pause (see SUSPENSION_DAYS) rather than a higher bar,
  // because a practitioner's late cancellation is already paid for.
  practitioner: { warnAt: 2, suspendAt: 3 },
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

/** A timestamp column as it arrives from either the database (string) or code. */
type Timestamp = Date | string | null;

/**
 * Whether a cancelled booking counts toward standing at all — the one place
 * this rule lives, so the profile card, the server booking gate and the admin
 * watchlist can never count different things.
 *
 * The test is "was this a booking the practitioner genuinely held and walked
 * away from", and the signal is `captured_at`: it is written by the
 * payment-success webhook and by nothing else, so a booking that was captured
 * is one that was paid for and a session the host was relying on. Everything
 * automatic leaves it null — an abandoned checkout, a Stripe-expired intent, a
 * request declined or never answered — and all of those are written as a
 * `cancelled_by = practitioner` cancellation only because the schema has no
 * other status for a released hold. Counting them would suspend someone for
 * closing a tab, which the product rule forbids. The party is checked too, so a
 * value that is neither side is ignored rather than assumed.
 */
export function countsTowardStanding(cancellation: {
  cancelledBy: string | null;
  capturedAt: Timestamp;
}): boolean {
  return (
    cancellation.capturedAt != null &&
    (cancellation.cancelledBy === "host" || cancellation.cancelledBy === "practitioner")
  );
}

/**
 * Turn cancelled-booking rows into the events `standingFor` reads, keeping only
 * the qualifying ones.
 *
 * The client's history, the server's booking gate and the mock all build their
 * cancellation history through this, so display and enforcement cannot diverge
 * on what a cancellation is — the abandoned-checkout exclusion is applied once,
 * here, rather than reimplemented at each caller. Party is left on the event and
 * filtered by `standingFor`, so this stays side-agnostic.
 */
export function toCancellationEvents(
  rows: readonly {
    cancelledBy: string | null;
    capturedAt: Timestamp;
    cancelledAt: Timestamp;
    sessionStart: Date | string;
  }[],
): CancellationEvent[] {
  return rows
    .filter((row) => countsTowardStanding(row) && row.cancelledAt != null)
    .map((row) => ({
      at: new Date(row.cancelledAt as Date | string),
      sessionStart: new Date(row.sessionStart),
      by: row.cancelledBy as Party,
    }));
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
    const until = new Date(trigger.getTime() + SUSPENSION_DAYS[party] * 86_400_000);

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
      return `Paused until ${standing.suspendedUntil!.toLocaleDateString("en-US", { month: "long", day: "numeric" })} after ${standing.lateCancellations} last-minute cancellations in ${STANDING_WINDOW_DAYS} days. You can't take ${noun} until then. Sessions already booked go ahead. Email ${SUPPORT_EMAIL} if this is wrong.`;

    case "warned":
      return `${standing.lateCancellations} last-minute cancellations in the past ${STANDING_WINDOW_DAYS} days. ${standing.remainingBeforeSuspension === 1 ? "One more" : `${standing.remainingBeforeSuspension} more`} and you won't be able to take ${noun} for ${SUSPENSION_DAYS[party]} days. Cancellations stop counting after ${STANDING_WINDOW_DAYS} days.`;

    case "clear":
      return standing.lateCancellations === 0
        ? `No last-minute cancellations in the past ${STANDING_WINDOW_DAYS} days. ${suspendAt} would pause your bookings for ${SUSPENSION_DAYS[party]} days.`
        : `${standing.lateCancellations} last-minute cancellation${standing.lateCancellations === 1 ? "" : "s"} in the past ${STANDING_WINDOW_DAYS} days. ${suspendAt} would pause your bookings for ${SUSPENSION_DAYS[party]} days.`;
  }
}
