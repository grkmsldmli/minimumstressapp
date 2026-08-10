/**
 * A studio's hours are wall-clock hours in the studio's own city.
 *
 * That sounds obvious and the app did not do it. `slotStartsForDate` built its
 * instants with `new Date(year, month, day, 0, minute)`, which reads whatever
 * timezone the *process* happens to be in. In the browser that is the
 * practitioner's zone; on Vercel it is UTC. So the phone offered 4pm Pacific,
 * the server checked its grid and found only 4pm UTC, and refused the booking
 * as an hour the host never opened. Every booking in production failed this
 * way, and no unit test could catch it because both sides passed alone — they
 * only disagreed across a timezone boundary neither one knew existed.
 *
 * The fix is to stop letting the ambient zone decide anything. A day here is a
 * `CivilDate`: a year, a month and a number on a wall calendar, with no instant
 * attached and nothing to be wrong about. It becomes a real moment in time only
 * when combined with a named zone, and the only zone that means anything to a
 * weekly schedule is the one the room is standing in.
 *
 * No dependency: `Intl` already carries the full timezone database, including
 * every past and future daylight-saving rule. It just cannot be asked questions
 * in this direction, so the direction is inverted below.
 */

/** A date on a wall calendar. `month` is 1-12, unlike `Date`. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Building one of these costs real time and we ask thousands of questions per
 * calendar render, so each zone's formatter is built once.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(instant: number, zone: string): Record<string, number> {
  let formatter = formatters.get(zone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  // Midnight comes back as hour 24 in some engines under hour12: false.
  parts.hour %= 24;
  return parts;
}

/**
 * How far ahead of UTC a zone is at a given instant, in milliseconds.
 *
 * Read the wall clock the zone shows at that instant, pretend those numbers are
 * UTC, and the gap between that and the real instant is the offset. Handles
 * daylight saving for free, because the wall clock already accounts for it.
 */
export function offsetMsAt(instant: number, zone: string): number {
  const p = partsIn(instant, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

/** What the calendar on that zone's wall reads at this instant. */
export function civilIn(instant: Date, zone: string): CivilDate {
  const p = partsIn(instant.getTime(), zone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Minutes since midnight on that zone's clock. */
export function minuteOfDayIn(instant: Date, zone: string): number {
  const p = partsIn(instant.getTime(), zone);
  return p.hour * 60 + p.minute;
}

/**
 * The moment a wall-clock time in a zone actually happens.
 *
 * Guess that the wall clock is UTC, measure how wrong that was, and subtract.
 * The second measurement matters on the two days a year the offset changes
 * between the guess and the answer — without it, a 2am start in March lands an
 * hour out.
 *
 * Returns null when the time does not exist. On the spring-forward morning the
 * clock jumps from 1:59 to 3:00, so a 2:30 block has no instant to point at,
 * and offering it would produce a booking for a moment that never arrives.
 */
export function instantFrom(civil: CivilDate, minuteOfDay: number, zone: string): Date | null {
  const asIfUtc = Date.UTC(civil.year, civil.month - 1, civil.day, 0, minuteOfDay);

  let instant = asIfUtc - offsetMsAt(asIfUtc, zone);
  const corrected = asIfUtc - offsetMsAt(instant, zone);
  if (corrected !== instant) instant = corrected;

  // In the autumn the same wall clock happens twice; the first is returned,
  // which is the one a person means when they say "we open at one".
  const check = partsIn(instant, zone);
  const landed =
    check.year === civil.year &&
    check.month === civil.month &&
    check.day === civil.day &&
    check.hour * 60 + check.minute === minuteOfDay;

  return landed ? new Date(instant) : null;
}

/**
 * Which day of the week a calendar date falls on, 0 = Sunday.
 *
 * Pure arithmetic on the date itself — a wall calendar says Tuesday in every
 * zone at once, so no zone is needed and none is accepted.
 */
export function weekdayOf(civil: CivilDate): number {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay();
}

/** The calendar date `days` later, rolling over months and years. */
export function addDays(civil: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/** Negative when `a` is earlier, so it can be handed straight to `sort`. */
export function compareCivil(a: CivilDate, b: CivilDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function sameCivil(a: CivilDate, b: CivilDate): boolean {
  return compareCivil(a, b) === 0;
}

/** Midday is deliberate: it is never the instant a DST change moves. */
export function civilToNoon(civil: CivilDate, zone: string): Date {
  return instantFrom(civil, 12 * 60, zone) ?? new Date(Date.UTC(civil.year, civil.month - 1, civil.day, 12));
}

/**
 * How the zone names itself right now — "PDT", "EST".
 *
 * Shown next to a time whenever the reader is somewhere else, so nobody books
 * a 9am that is really 6am where the room is.
 */
export function zoneAbbreviation(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(instant);

  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** The zone the person reading the screen is in. */
export function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * True when a time needs its zone spelled out.
 *
 * Comparing the names is not enough: America/Los_Angeles and US/Pacific are the
 * same clock under two spellings, and labelling one against the other would be
 * noise. What matters is whether the two zones disagree about this instant.
 */
export function zonesDiffer(a: string, b: string, at: Date = new Date()): boolean {
  if (a === b) return false;
  return offsetMsAt(at.getTime(), a) !== offsetMsAt(at.getTime(), b);
}

/** A safe fallback, and the only place the app is allowed to assume a zone. */
export const FALLBACK_ZONE = "America/Los_Angeles";

/**
 * Whether a string is a zone worth storing against a room.
 *
 * Two questions, and the second is the one that matters. `Intl` resolving the
 * name is necessary — a typo stored once would throw on every render of that
 * listing — but not sufficient, because it also accepts bare abbreviations and
 * quietly resolves them to the wrong place. Ask this runtime for "EST" and it
 * hands back America/Panama, which does not observe daylight saving: a studio
 * in New York stored that way would be an hour out for half the year, and
 * every slot it offered would be refused by a server that disagreed.
 *
 * So the region form is required, which is what `tz-lookup` returns anyway and
 * what the check constraint in migration 0029 enforces on the other side.
 */
const REGION_FORM = /^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_.-]+)+$/;

export function isKnownZone(zone: string): boolean {
  if (!REGION_FORM.test(zone)) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
