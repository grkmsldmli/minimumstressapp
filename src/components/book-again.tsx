"use client";

import { RotateCcw } from "lucide-react";

import type { Rebookable } from "@/lib/rebook";
import { sessionDate, sessionHour, sessionWeekday } from "@/lib/when";

/**
 * Rooms somebody has used, at the hour they used them.
 *
 * Booking a room is more repetitive than most things people buy — a teacher
 * with a Tuesday class books the same room at the same hour every week — and
 * the app made them walk the whole discovery flow every time for a decision
 * taken months ago.
 *
 * The hour is the point. "Willow Room" on its own still leaves them a calendar
 * to open and a slot to find; "Willow Room, Tuesday 2pm" is the booking.
 */
export function BookAgain({
  rooms,
  onPick,
}: {
  rooms: Rebookable[];
  onPick: (entry: Rebookable) => void;
}) {
  if (rooms.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 px-6 mb-2.5">
        <RotateCcw size={12} className="text-sky-text" />
        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.14em] text-sky-text">
          Book again
        </p>
      </div>

      <div className="flex gap-2.5 overflow-x-auto no-scrollbar px-6">
        {rooms.map((room) => (
          <button
            key={room.spaceId}
            type="button"
            onClick={() => onPick(room)}
            className="shrink-0 text-left rounded-2xl px-4 py-3 press"
            style={{ backgroundColor: "#fff", border: "1px solid #DCE7F2", minWidth: 172 }}
          >
            <p className="font-body font-medium text-[15px] truncate text-navy">{room.spaceName}</p>
            <p className="font-body font-normal text-[13.5px] mt-0.5 text-sky-text">
              {sessionWeekday(room.nextStart, room.timeZone)}{" "}
              {sessionHour(room.nextStart, room.timeZone)}
            </p>
            {/*
              What they are repeating, so the suggestion is checkable rather
              than something the app decided about them.
            */}
            <p className="font-body font-normal text-[12px] mt-0.5 text-ink-faint">
              Last used{" "}
              {sessionDate(room.lastStart, room.timeZone)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
