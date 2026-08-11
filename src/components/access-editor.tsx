"use client";

import type { AccessDetails } from "@/lib/access-details";

/**
 * The four access questions, asked of the host.
 *
 * Specific answers rather than a box marked "accessible", because that box was
 * a question most hosts could not answer honestly. A studio with one shallow
 * step is neither accessible nor inaccessible, and the room itself may be
 * perfect — so the box got ticked in good faith and somebody was stranded on a
 * pavement.
 *
 * Every question can be left unanswered, and unanswered is shown to
 * practitioners as unanswered. Forcing a choice is how a guess becomes a
 * claim, and a wrong claim here costs somebody a session they paid for.
 */

const ENTRANCE = [
  { value: "step_free", label: "Step-free" },
  { value: "one_step", label: "One step" },
  { value: "steps", label: "Steps" },
] as const;

const FLOOR = [
  { value: "ground_floor", label: "Ground floor" },
  { value: "lift", label: "Lift" },
  { value: "stairs_only", label: "Stairs only" },
] as const;

const RESTROOM = [
  { value: "accessible", label: "Accessible" },
  { value: "standard", label: "Standard" },
  { value: "none", label: "None on site" },
] as const;

/**
 * `onChange` takes an updater rather than a value, and both callers pass their
 * `useState` setter straight in.
 *
 * The value form spread the prop, which is the snapshot from the last render.
 * Two answers picked before that render commits both build on the same stale
 * object and the first one silently disappears — a listing that says nothing
 * about its entrance because the host also answered the floor question.
 */
export function AccessEditor({
  details,
  onChange,
}: {
  details: AccessDetails;
  onChange: (update: (previous: AccessDetails) => AccessDetails) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Question
        label="From the street to the front door"
        options={ENTRANCE}
        value={details.entrance}
        onPick={(entrance) => onChange((previous) => ({ ...previous, entrance }))}
      />

      <Question
        label="From the door to the room"
        options={FLOOR}
        value={details.floor}
        onPick={(floor) => onChange((previous) => ({ ...previous, floor }))}
      />

      {/*
        The doorway measurement used to be asked here, and it was the only
        question on this form that sent somebody looking for a tape measure.
        Three live listings, none of them answered it — and a field nobody
        fills is worse than no field, because the form still looks as though
        we asked.

        The three questions left are each one tap, from memory, standing
        anywhere. Somebody who genuinely needs the width is told to message the
        host, which a host can answer in a sentence far more easily than by
        pre-measuring every door in the building. Stored widths still render on
        the listing, for any host who did measure.
      */}

      <Question
        label="Restroom"
        options={RESTROOM}
        value={details.restroom}
        onPick={(restroom) => onChange((previous) => ({ ...previous, restroom }))}
      />
    </div>
  );
}

function Question<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onPick: (value: T | null) => void;
}) {
  return (
    <div>
      <p className="font-body font-normal text-[13.5px] mb-1.5 text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const chosen = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              // Tapping the chosen one clears it, so an answer given by
              // accident can be taken back rather than only replaced.
              onClick={() => onPick(chosen ? null : option.value)}
              className="px-3.5 py-2 rounded-full font-body text-[14px] press"
              style={
                chosen
                  ? { backgroundColor: "#2578C2", color: "#fff" }
                  : { border: "1px solid #DCE7F2", color: "#4D6480" }
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
