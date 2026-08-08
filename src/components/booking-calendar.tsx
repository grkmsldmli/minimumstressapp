"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { AvailabilityBlock } from "@/lib/availability";
import { BOOKING_HORIZON_DAYS } from "@/lib/money";

/**
 * A month, so somebody can see the shape of a room's week.
 *
 * This was a horizontal strip of eight days. Eight is not an arbitrary number
 * — a card authorisation is held rather than charged and lives about a week,
 * so it is the furthest a booking can be made without re-authorising — but a
 * strip is the wrong way to show it. Nobody can tell from a row of chips that
 * a studio opens every Tuesday and Friday, which is the single most useful
 * thing to know about a room you might use every week.
 *
 * So: the whole month, with the host's open days marked. Days past the
 * authorisation window are shown rather than hidden, greyed and unclickable,
 * with one line saying when they open. That is more information than the strip
 * gave, not less, and it still promises nothing the payment model cannot keep.
 */

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

export function BookingCalendar({
  availability,
  selected,
  now,
  onPick,
}: {
  availability: readonly AvailabilityBlock[];
  /** The day being shown below. Null before anything is chosen. */
  selected: Date | null;
  now: Date;
  onPick: (day: Date) => void;
}) {
  const today = startOfDay(now);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  /** Weekdays this room ever opens. The pattern repeats every week. */
  const openWeekdays = useMemo(
    () => new Set(availability.map((block) => block.weekday)),
    [availability],
  );

  const lastBookable = useMemo(
    () =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() + BOOKING_HORIZON_DAYS),
    [today],
  );

  /** Whole weeks, so the grid never jumps as months change length. */
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());

    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const inMonth = day.getMonth() === month.getMonth();
      const open = openWeekdays.has(day.getDay());
      const past = day < today;
      const beyond = day > lastBookable;

      return { day, inMonth, open, past, beyond, bookable: open && !past && !beyond };
    });
  }, [month, openWeekdays, today, lastBookable]);

  const atFirstMonth =
    month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();

  const step = (by: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

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
          {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
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
          const isSelected = selected !== null && sameDay(day, selected);
          const isToday = sameDay(day, today);

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={!bookable}
              onClick={() => onPick(day)}
              aria-label={day.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
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
              {day.getDate()}
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
        Open days are marked. Your card is held rather than charged, and a hold lasts about a week —
        so booking opens {BOOKING_HORIZON_DAYS} days ahead, and later dates become available as they
        come closer.
      </p>
    </div>
  );
}
