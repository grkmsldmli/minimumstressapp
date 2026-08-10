import type { Booking } from "./domain";
import { addDays, civilIn, compareCivil, instantFrom, minuteOfDayIn, weekdayOf } from "./timezone";

/**
 * Rooms somebody has used before, and the hour they used them at.
 *
 * Booking a room is more repetitive than most things people buy: a teacher
 * with a Tuesday class books the same room at the same hour every week. The
 * app made them search for it, open it, pick a day and pick a time, every
 * single time — a fresh discovery flow for a decision that was made months
 * ago.
 *
 * So the shortcut is not "here is that room again", it is "here is that room,
 * at that hour, on the next day it comes round". The room alone still leaves
 * them the whole calendar to walk.
 */

export interface Rebookable {
  spaceId: string;
  spaceName: string;
  /** The hour they last held, projected onto its next occurrence. */
  nextStart: Date;
  /** When they were last there, for the label. */
  lastStart: Date;
  /** The room's zone, so the suggested hour is written the way it was booked. */
  timeZone: string;
}

/**
 * Most recently used first.
 *
 * Cancellations are excluded: a session somebody called off is not one they
 * want offered back to them, and a no-show even less so. Only sessions that
 * actually happened, plus ones still ahead — a booking made for tomorrow is
 * evidence of the same habit.
 */
export function rebookable(
  bookings: readonly Booking[],
  now: Date,
  horizonDays: number,
  limit = 4,
): Rebookable[] {
  const usable = bookings
    .filter((b) => b.status === "completed" || b.status === "upcoming")
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  const bySpace = new Map<string, Booking>();
  for (const booking of usable) {
    if (!bySpace.has(booking.spaceId)) bySpace.set(booking.spaceId, booking);
  }

  return [...bySpace.values()]
    .map((booking) => {
      const nextStart = nextOccurrence(booking.startsAt, now, horizonDays, booking.timeZone);
      return nextStart
        ? {
            spaceId: booking.spaceId,
            spaceName: booking.spaceName,
            nextStart,
            lastStart: booking.startsAt,
            timeZone: booking.timeZone,
          }
        : null;
    })
    .filter((entry): entry is Rebookable => entry !== null)
    .slice(0, limit);
}

/**
 * The same weekday and time, on its next turn inside the booking window.
 *
 * Returns null when that lands outside the window — offering a slot the
 * booking rules would refuse is the fault this app keeps finding, and there is
 * no honest version of a shortcut that leads to a refusal.
 *
 * Counted on the room's calendar, which is the same rule the slot grid and the
 * horizon check follow. Read in the practitioner's zone instead, "Tuesday 5pm"
 * for a studio three hours west becomes Tuesday 2pm there, or Monday
 * altogether — and the shortcut would lead to exactly the refusal above.
 */
export function nextOccurrence(
  previous: Date,
  now: Date,
  horizonDays: number,
  timeZone: string,
): Date | null {
  const wanted = minuteOfDayIn(previous, timeZone);
  const wantedWeekday = weekdayOf(civilIn(previous, timeZone));
  const today = civilIn(now, timeZone);

  // Step forward to the same weekday. Today counts only if the hour is still
  // ahead of us — a 10am slot suggested at 3pm is not a suggestion.
  let day = addDays(today, (wantedWeekday - weekdayOf(today) + 7) % 7);

  let candidate = instantFrom(day, wanted, timeZone);
  if (!candidate || candidate.getTime() <= now.getTime()) {
    day = addDays(day, 7);
    candidate = instantFrom(day, wanted, timeZone);
  }

  // Null only if that hour does not exist on the day it landed on, which is
  // the daylight-saving gap. There is no honest hour to offer instead.
  if (!candidate) return null;

  return compareCivil(day, addDays(today, horizonDays)) <= 0 ? candidate : null;
}
