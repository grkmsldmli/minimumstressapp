/**
 * The same hour, every week, booked in one go.
 *
 * A practitioner teaching a weekly class books the identical slot four times a
 * month, and the app made them walk the whole discovery flow for each one — a
 * decision they made in September, re-entered every Tuesday.
 *
 * The rules here are deliberately dull: pick the dates, refuse the ones that
 * cannot work, and say which. What matters is the partial case, because it is
 * the normal one. Somebody booking four Tuesdays will find that one of them is
 * already taken, and the honest answer is three bookings and a sentence about
 * the fourth — not a refusal of the lot, and not a silent three.
 */

import { BOOKING_HORIZON_DAYS, horizonDaysFor } from "./money";
import { addDays, civilIn, compareCivil, instantFrom } from "./timezone";

/**
 * The most a single request may book.
 *
 * Not a business limit — the horizon already caps it — but a bound on what one
 * request can do. Without it a crafted payload asks for a thousand occurrences
 * and gets a thousand rejections computed one at a time.
 */
export const MAX_SERIES_OCCURRENCES = 12;

export interface SeriesRequest {
  /** The first session, which is booked like any other. */
  firstStart: Date;
  /** How many weeks including the first. */
  weeks: number;
  timeZone: string;
  isPro: boolean;
  now: Date;
}

/**
 * Every instant a series would occupy, dropping any the horizon cannot reach.
 *
 * Weekly means the same weekday and the same wall-clock hour, which is not the
 * same as adding 168 hours: across a daylight-saving change that would move a
 * five o'clock class to four. So each date is stepped on the calendar and
 * turned back into an instant in the room's own zone.
 *
 * An occurrence whose hour does not exist that week — the spring-forward gap —
 * is dropped rather than shifted, for the same reason a single booking is.
 */
export function seriesOccurrences(request: SeriesRequest): Date[] {
  const { firstStart, weeks, timeZone, isPro, now } = request;

  const wanted = Math.min(Math.max(1, Math.trunc(weeks)), MAX_SERIES_OCCURRENCES);
  const firstDay = civilIn(firstStart, timeZone);
  const minuteOfDay = minutesInto(firstStart, timeZone);

  const lastDay = addDays(civilIn(now, timeZone), horizonDaysFor(isPro));

  const starts: Date[] = [];
  for (let week = 0; week < wanted; week += 1) {
    const day = addDays(firstDay, week * 7);
    if (compareCivil(day, lastDay) > 0) break;

    const instant = instantFrom(day, minuteOfDay, timeZone);
    if (instant) starts.push(instant);
  }

  return starts;
}

/** Minutes since midnight on the room's clock, without exporting the helper. */
function minutesInto(instant: Date, timeZone: string): number {
  const civil = civilIn(instant, timeZone);
  const midnight = instantFrom(civil, 0, timeZone);
  if (!midnight) return 0;
  return Math.round((instant.getTime() - midnight.getTime()) / 60_000);
}

/**
 * How many weeks a series could run from here, so the picker offers only real
 * choices rather than letting somebody pick eight and receive four.
 */
export function weeksAvailable(
  firstStart: Date,
  timeZone: string,
  isPro: boolean,
  now: Date,
): number {
  return seriesOccurrences({
    firstStart,
    weeks: MAX_SERIES_OCCURRENCES,
    timeZone,
    isPro,
    now,
  }).length;
}

export interface SeriesOutcome {
  /** Sessions that were booked, in order. */
  booked: { startsAt: Date; bookingId: string }[];
  /** Ones that could not be, and why in words somebody can act on. */
  skipped: { startsAt: Date; because: string }[];
}

/**
 * What to tell somebody afterwards.
 *
 * Written as a whole rather than as a count, because "3 of 4" invites the
 * question this sentence should already answer: which one, and what now.
 */
export function describeSeries(outcome: SeriesOutcome): string {
  const booked = outcome.booked.length;
  const skipped = outcome.skipped.length;

  if (booked === 0) return "None of those weeks could be booked.";
  if (skipped === 0) {
    return booked === 1 ? "That session is booked." : `All ${booked} weeks are booked.`;
  }

  return `${booked} of ${booked + skipped} weeks booked. The rest are listed below — book them separately if another time works.`;
}

/** A free account cannot hold a term. Said once, here, so screens agree. */
export function seriesNeedsPro(weeks: number): boolean {
  return weeks > 1;
}

export { BOOKING_HORIZON_DAYS };
