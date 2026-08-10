/**
 * Weekly availability is a recurring template, not fixed dates. Each weekday
 * holds any number of independent blocks, so a host can open 7-8am, 2-3pm and
 * 5-9pm on the same Monday and keep the gaps for themselves.
 *
 * Stored as a flat list because that is exactly how it lives in the database:
 * one row per block. Grouping is a display concern.
 */

import type { AvailabilityBlock } from "./taxonomy";
import { type CivilDate, instantFrom, weekdayOf } from "./timezone";

export type { AvailabilityBlock };

export const MINUTES_IN_DAY = 24 * 60;

export type BlockProblem =
  | { kind: "inverted"; block: AvailabilityBlock }
  | { kind: "overlap"; block: AvailabilityBlock; with: AvailabilityBlock };

/** Blocks for one weekday, earliest first. */
export function blocksForDay(
  blocks: readonly AvailabilityBlock[],
  weekday: number,
): AvailabilityBlock[] {
  return blocks
    .filter((b) => b.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
}

/**
 * Everything wrong with a schedule.
 *
 * The prototype let a host pick an end time before the start and saved it
 * without complaint, which yields a block that can never produce a bookable
 * slot. Overlaps are just as bad: they would double-offer the same hour.
 */
export function findProblems(blocks: readonly AvailabilityBlock[]): BlockProblem[] {
  const problems: BlockProblem[] = [];

  for (const block of blocks) {
    if (block.endMinute <= block.startMinute) {
      problems.push({ kind: "inverted", block });
    }
  }

  const weekdays = new Set(blocks.map((b) => b.weekday));
  for (const weekday of weekdays) {
    const day = blocksForDay(blocks, weekday).filter((b) => b.endMinute > b.startMinute);
    for (let i = 1; i < day.length; i += 1) {
      const previous = day[i - 1];
      const current = day[i];
      if (current.startMinute < previous.endMinute) {
        problems.push({ kind: "overlap", block: current, with: previous });
      }
    }
  }

  return problems;
}

export function isValidSchedule(blocks: readonly AvailabilityBlock[]): boolean {
  return findProblems(blocks).length === 0;
}

/** Merge touching or overlapping blocks so the stored template stays canonical. */
export function normalize(blocks: readonly AvailabilityBlock[]): AvailabilityBlock[] {
  const result: AvailabilityBlock[] = [];

  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const day = blocksForDay(blocks, weekday).filter((b) => b.endMinute > b.startMinute);
    for (const block of day) {
      const last = result[result.length - 1];
      if (last && last.weekday === weekday && block.startMinute <= last.endMinute) {
        last.endMinute = Math.max(last.endMinute, block.endMinute);
      } else {
        result.push({ ...block });
      }
    }
  }

  return result;
}

/**
 * The hour-long start times a space actually offers on a given date.
 *
 * A slot is offered only if the whole hour, plus the host's turnover buffer,
 * fits inside one availability block — so a 7-8am block yields exactly one 7am
 * slot rather than a 7:30 start that would overrun.
 *
 * The date is a `CivilDate` and the zone is the room's, and both are required
 * for the same reason. This used to take a `Date` and read its local fields,
 * which meant the answer depended on where the code was running: the browser
 * built the grid in the practitioner's zone and the server rebuilt it in UTC,
 * so the two never agreed on what a 9am block meant and every booking was
 * refused as an hour the host had not opened. A day on a wall calendar has no
 * timezone to get wrong, and naming the room's zone once is what turns it into
 * the same list of instants everywhere.
 */
export function slotStartsForDate(
  blocks: readonly AvailabilityBlock[],
  date: CivilDate,
  timeZone: string,
  bufferMinutes = 0,
): Date[] {
  const needed = 60 + bufferMinutes;
  const starts: Date[] = [];

  for (const block of blocksForDay(blocks, weekdayOf(date))) {
    if (block.endMinute <= block.startMinute) continue;
    for (let m = block.startMinute; m + needed <= block.endMinute; m += 60) {
      // Null on the spring-forward morning, when the clock skips the hour the
      // host opened. Dropped rather than shifted: an hour that never happens
      // cannot be sat in, and moving it would book a different one silently.
      const start = instantFrom(date, m, timeZone);
      if (start) starts.push(start);
    }
  }

  return starts.sort((a, b) => a.getTime() - b.getTime());
}
