"use client";

import { useState } from "react";

import {
  BOOKING_USES,
  type DeclaredUse,
  MAX_OTHER_CHARS,
  MIN_OTHER_CHARS,
  allowsUse,
  bookingUse,
} from "@/lib/booking-use";

/**
 * What the space will be used for, asked once, just before booking.
 *
 * Two questions and no more. The temptation with a form like this is to ask
 * everything that might matter — will clients attend, will you film, will you
 * move furniture — and every one of those turns a two-tap booking into a
 * questionnaire. What it actually needs is the use and the number of people,
 * because those are the two things a host's rules are written in terms of and
 * the two things a later dispute turns on.
 *
 * The uses shown are the ones this host allows. A room that does not offer
 * filming does not list filming and then refuse it: the option is absent, so
 * nobody picks a thing they cannot have and reads the refusal as the site
 * being broken.
 */
export function DeclareUse({
  allowedUses,
  capacity,
  value,
  onChange,
}: {
  allowedUses: readonly string[];
  capacity: number;
  value: DeclaredUse | null;
  onChange: (declared: DeclaredUse | null) => void;
}) {
  const [note, setNote] = useState("");

  const offered = BOOKING_USES.filter((use) => allowsUse({ allowedUses, capacity }, use.key));
  const chosen = value ? bookingUse(value.purpose) : null;
  const attendees = value?.attendees ?? 1;

  const set = (purpose: string, people: number, detail: string) => {
    onChange({ purpose, attendees: people, purposeNote: purpose === "other" ? detail : null });
  };

  return (
    <div className="mt-6">
      <p className="font-body font-medium text-[15px] text-navy">
        What will you use the space for?
      </p>

      <div className="flex flex-wrap gap-2 mt-3">
        {offered.map((use) => {
          const active = value?.purpose === use.key;
          return (
            <button
              key={use.key}
              type="button"
              onClick={() => set(use.key, attendees, note)}
              className="px-3.5 py-2 rounded-full font-body text-[13.5px] press"
              style={
                active
                  ? { backgroundColor: "#2578C2", color: "#fff" }
                  : { border: "1px solid #DCE7F2", color: "#4D6480" }
              }
            >
              {use.label}
            </button>
          );
        })}
      </div>

      {/*
        Only for "something else". A note beside a purpose that already says
        what it is would be a second answer to a question already answered.
      */}
      {chosen?.key === "other" && (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(event) => {
              const next = event.target.value.slice(0, MAX_OTHER_CHARS);
              setNote(next);
              set("other", attendees, next);
            }}
            rows={2}
            placeholder="What will you be doing?"
            className="w-full px-4 py-3 rounded-xl font-body font-normal text-[15px] text-navy outline-none resize-none"
            style={{ border: "1px solid #DCE7F2" }}
          />
          {note.trim().length > 0 && note.trim().length < MIN_OTHER_CHARS && (
            <p className="font-body font-normal text-[13px] mt-1 text-ink-soft">
              A little more, so the host knows what to expect.
            </p>
          )}
        </div>
      )}

      <p className="font-body font-medium text-[15px] text-navy mt-5">
        How many people, including you?
      </p>

      <div className="flex flex-wrap gap-2 mt-3">
        {Array.from({ length: Math.min(capacity, 12) }, (_, index) => index + 1).map((people) => (
          <button
            key={people}
            type="button"
            onClick={() => set(value?.purpose ?? "", people, note)}
            disabled={!value?.purpose}
            className="w-11 h-11 rounded-full font-body text-[14px] press disabled:opacity-40"
            style={
              value?.attendees === people
                ? { backgroundColor: "#2578C2", color: "#fff" }
                : { border: "1px solid #DCE7F2", color: "#4D6480" }
            }
          >
            {people}
          </button>
        ))}
      </div>

      <p className="font-body font-normal text-[13px] leading-relaxed mt-3 text-ink-soft">
        Maximum capacity: {capacity} {capacity === 1 ? "person" : "people"}. Please keep your
        purpose and attendee count accurate.
      </p>

      {/*
        One line, not a wall of checkboxes. Booking is the agreement; the server
        stamps rules_ack_at at that moment (migration 0058) so a dispute can
        point to it. Shown once a purpose is chosen, so "the purpose you
        selected" refers to something.
      */}
      {value?.purpose && (
        <p className="font-body font-normal text-[13px] leading-relaxed mt-4 text-ink-soft">
          By booking, you agree to use the space only for the purpose you selected and to follow
          the space and platform rules.
        </p>
      )}
    </div>
  );
}
