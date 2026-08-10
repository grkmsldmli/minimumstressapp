/**
 * Writing out the time of a session.
 *
 * A booking's `startsAt` is an absolute instant and is never wrong. What it is
 * *called* is another matter: `toLocaleTimeString` with no zone names it on the
 * reader's clock, so a room in Denver booked from California reads as an hour
 * three hours off, and the practitioner arrives to a locked door.
 *
 * Every session time in the app comes through here, so the rule lives once. The
 * zone is always the room's — that is the clock the host set their hours on and
 * the one the door is opened by.
 *
 * Timestamps are a different question and deliberately not covered: "sent at
 * 4:02pm" or "you uploaded this on Tuesday" are about the reader's own day, and
 * should stay on the reader's clock.
 */

import { minuteOfDayIn, viewerZone, zoneAbbreviation, zonesDiffer } from "./timezone";

/**
 * The zone's short name, or null when saying it would be noise.
 *
 * Only appended when the reader is somewhere else. For everyone in the same
 * city — which today is everyone — this adds nothing to read past.
 */
export function sessionZoneLabel(at: Date, timeZone: string): string | null {
  return zonesDiffer(timeZone, viewerZone(), at) ? zoneAbbreviation(at, timeZone) : null;
}

/** Appends the zone only when the reader needs it. */
function withZone(text: string, at: Date, timeZone: string): string {
  const label = sessionZoneLabel(at, timeZone);
  return label ? `${text} ${label}` : text;
}

/** "2:00 PM", or "2:00 PM PDT" when the reader is elsewhere. */
export function sessionTime(at: Date, timeZone: string): string {
  return withZone(
    at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }),
    at,
    timeZone,
  );
}

/** "Tuesday" — the room's day, which can differ from the reader's. */
export function sessionWeekday(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-US", { weekday: "long", timeZone });
}

/** "Aug 12" */
export function sessionDate(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
}

/**
 * "2 PM" on the hour, "2:30 PM" otherwise — for cards where the ":00" is noise.
 *
 * The minutes are read on the room's clock, not the reader's. India and
 * Newfoundland run on half-hour offsets, so an hour that is round in one place
 * is not in another, and `getMinutes()` would answer for the wrong one.
 */
export function sessionHour(at: Date, timeZone: string): string {
  const onTheHour = minuteOfDayIn(at, timeZone) % 60 === 0;

  return withZone(
    at.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: onTheHour ? undefined : "2-digit",
      timeZone,
    }),
    at,
    timeZone,
  );
}

/** "Tue, Aug 12" — the compact form, for headers with little room. */
export function sessionDayShort(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

/** "Tuesday, Aug 12" */
export function sessionDayLong(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

/** "Tuesday, Aug 12 at 2:00 PM" — the full answer, for confirmations and email. */
export function sessionWhen(at: Date, timeZone: string): string {
  return withZone(
    at.toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }),
    at,
    timeZone,
  );
}
