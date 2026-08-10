"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { AvailabilityBlock } from "@/lib/availability";
import { BOOKING_HORIZON_DAYS } from "@/lib/money";
import {
  type CivilDate,
  addDays,
  civilIn,
  compareCivil,
  civilToNoon,
  sameCivil,
  weekdayOf,
} from "@/lib/timezone";

/**
 * A month, so somebody can see the shape of a room's week.
 *
 * This was a horizontal strip of eight days, which is the wrong way to show a
 * repeating weekly schedule: nobody can tell from a row of chips that a studio
 * opens every Tuesday and Friday, and that is the single most useful thing to
 * know about a room you might use every week.
 *
 * So: the whole month, with the host's open days marked. Days past the booking
 * window are shown rather than hidden, greyed and unclickable, with one line
 * saying when they open. That is more information than the strip gave, not
 * less, and it promises nothing the app cannot keep.
 *
 * Every date here is the room's date, not the reader's. A practitioner in New
 * York looking at a studio in California is choosing among the studio's days,
 * and "today" is today where the room is — otherwise the grid and the server
 * would disagree by a day for anyone who is not standing in the same city.
 */

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

export function BookingCalendar({
  availability,
  timeZone,
  selected,
  now,
  onPick,
}: {
  availability: readonly AvailabilityBlock[];
  /** The room's zone, which is the calendar this grid is drawn in. */
  timeZone: string;
  /** The day being shown below. Null before anything is chosen. */
  selected: CivilDate | null;
  now: Date;
  onPick: (day: CivilDate) => void;
}) {
  const today = useMemo(() => civilIn(now, timeZone), [now, timeZone]);
  const [month, setMonth] = useState(() => ({ year: today.year, month: today.month }));

  /** Weekdays this room ever opens. The pattern repeats every week. */
  const openWeekdays = useMemo(
    () => new Set(availability.map((block) => block.weekday)),
    [availability],
  );

  const lastBookable = useMemo(
    () => addDays(today, BOOKING_HORIZON_DAYS),
    [today],
  );

  /** Whole weeks, so the grid never jumps as months change length. */
  const cells = useMemo(() => {
    const first: CivilDate = { year: month.year, month: month.month, day: 1 };
    const start = addDays(first, -weekdayOf(first));

    return Array.from({ length: 42 }, (_, i) => {
      const day = addDays(start, i);
      const inMonth = day.month === month.month && day.year === month.year;
      const open = openWeekdays.has(weekdayOf(day));
      const past = compareCivil(day, today) < 0;
      const beyond = compareCivil(day, lastBookable) > 0;

      return { day, inMonth, open, past, beyond, bookable: open && !past && !beyond };
    });
  }, [month, openWeekdays, today, lastBookable]);

  const atFirstMonth = month.year === today.year && month.month === today.month;

  const step = (by: number) => {
    const moved = addDays({ year: month.year, month: month.month, day: 15 }, by * 30);
    setMonth({ year: moved.year, month: moved.month });
  };

  /** Only for month names and day labels, where a real Date is what Intl wants. */
  const noon = (day: CivilDate) => civilToNoon(day, timeZone);

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={atFirstMonth}
          aria-label="Previous month"
          className="w-8 h-8 rounded-full flex items-center justify-center press"
          style={{
            border: "1px solid #DCE7F2",
            opacity: atFirstMonth ? 0.35 : 1,
            color: "#16304E",
          }}
        >
          <ChevronLeft size={15} />
        </button>

        <p className="font-body font-medium text-[15px] text-navy">
          {noon({ ...month, day: 1 }).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone,
          })}
        </p>

        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next month"
          className="w-8 h-8 rounded-full flex items-center justify-center press"
          style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_INITIALS.map((initial, i) => (
          <span
            key={i}
            className="text-center font-body font-semibold text-[12px] text-ink-faint"
            aria-hidden="true"
          >
            {initial}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ day, inMonth, open, past, beyond, bookable }) => {
          const isSelected = selected !== null && sameCivil(day, selected);
          const isToday = sameCivil(day, today);

          return (
            <button
              key={`${day.year}-${day.month}-${day.day}`}
              type="button"
              disabled={!bookable}
              onClick={() => onPick(day)}
              aria-label={noon(day).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone,
              })}
              className="aspect-square rounded-lg flex flex-col items-center justify-center font-body text-[14px] press"
              style={{
                /*
                 * Three states, and they have to be told apart at a glance:
                 * bookable, open-but-not-yet, and closed. A day the room is
                 * simply shut should not look like one we are withholding.
                 */
                backgroundColor: isSelected ? "#16304E" : bookable ? "#EDF6FE" : "transparent",
                color: isSelected
                  ? "#fff"
                  : !inMonth
                    ? "#B9CBDD"
                    : bookable
                      ? "#16304E"
                      : open && beyond
                        ? "#566D85"
                        : "#8BA3BD",
                border: isToday && !isSelected ? "1px solid #2578C2" : "1px solid transparent",
                opacity: past || !inMonth ? 0.45 : 1,
              }}
            >
              {day.day}
              {/* A dot only where the room actually opens. */}
              <span
                className="mt-0.5 rounded-full"
                style={{
                  width: 4,
                  height: 4,
                  backgroundColor: !open
                    ? "transparent"
                    : isSelected
                      ? "#8FC6F5"
                      : bookable
                        ? "#2578C2"
                        : "#B9CBDD",
                }}
              />
            </button>
          );
        })}
      </div>

      <p className="font-body font-normal text-[13.5px] mt-2.5 leading-relaxed text-ink-faint">
        Open days are marked. Booking opens {BOOKING_HORIZON_DAYS} days ahead, and later dates
        become available as they come closer.
      </p>
    </div>
  );
}
