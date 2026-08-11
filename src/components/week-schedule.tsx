"use client";

import { Plus, X } from "lucide-react";

import {
  type AvailabilityBlock,
  blocksForDay,
  findProblems,
} from "@/lib/availability";
import { SELECTABLE_HOURS, WEEKDAYS, formatMinuteOfDay } from "@/lib/taxonomy";

import { Toggle } from "./primitives";

const DEFAULT_START = 9 * 60;
const DEFAULT_END = 17 * 60;

/**
 * The recurring weekly template. Each day toggles independently and holds any
 * number of blocks, so a host can open 7-8am, 2-3pm and 5-9pm on one Monday and
 * keep the gaps for their own use.
 *
 * Blocks are a flat list rather than a per-day tree, matching how they are
 * stored — one row per block — so nothing has to be reshaped on save.
 *
 * `onChange` takes an updater, and every caller passes its `useState` setter
 * straight in. Building the next list from the `blocks` prop reads the
 * snapshot of the last render, so a host opening two days faster than React
 * commits gets one of them — which looks exactly like hours that did not save.
 */
export function WeekSchedule({
  blocks,
  onChange,
}: {
  blocks: AvailabilityBlock[];
  onChange: (update: (previous: AvailabilityBlock[]) => AvailabilityBlock[]) => void;
}) {
  const problems = findProblems(blocks);

  const problemFor = (block: AvailabilityBlock) =>
    problems.find(
      (p) =>
        p.block.weekday === block.weekday &&
        p.block.startMinute === block.startMinute &&
        p.block.endMinute === block.endMinute,
    );

  const setDayOpen = (weekday: number, open: boolean) => {
    onChange((previous) =>
      open
        ? [...previous, { weekday, startMinute: DEFAULT_START, endMinute: DEFAULT_END }]
        : previous.filter((b) => b.weekday !== weekday),
    );
  };

  const addBlock = (weekday: number) => {
    onChange((previous) => [
      ...previous,
      { weekday, startMinute: DEFAULT_START, endMinute: DEFAULT_END },
    ]);
  };

  /*
   * Identity, not position. The index is looked up inside the updater against
   * the list being changed — a index taken from the rendered array points at
   * the wrong block once anything else has moved.
   */
  const removeBlock = (target: AvailabilityBlock) => {
    onChange((previous) => previous.filter((b) => b !== target));
  };

  const updateBlock = (
    target: AvailabilityBlock,
    field: "startMinute" | "endMinute",
    value: number,
  ) => {
    onChange((previous) =>
      previous.map((b) => (b === target ? { ...b, [field]: value } : b)),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {WEEKDAYS.map(({ weekday, short }) => {
        const day = blocksForDay(blocks, weekday);
        const open = day.length > 0;

        return (
          <div
            key={weekday}
            className="rounded-xl overflow-hidden"
            style={{ border: `1px solid ${open ? "#D4E8FA" : "#E7EEF6"}` }}
          >
            <div
              className="flex items-center gap-3 px-3.5 py-3"
              style={{ backgroundColor: open ? "#F4F8FC" : "#fff" }}
            >
              <span
                className={`font-body font-medium text-[15px] w-8 ${open ? "text-navy" : "text-ink-faint"}`}
              >
                {short}
              </span>
              <Toggle
                on={open}
                onClick={() => setDayOpen(weekday, !open)}
                label={`${short} availability`}
              />
              {!open && (
                <span className="flex-1 text-right font-body text-[14px] text-ink-faint">
                  Closed
                </span>
              )}
            </div>

            {open && (
              <div className="px-3.5 pb-3 pt-0.5 card-in" style={{ backgroundColor: "#F4F8FC" }}>
                <div className="flex flex-col gap-1.5">
                  {day.map((block) => {
                    const problem = problemFor(block);
                    return (
                      <div key={`${block.startMinute}-${block.endMinute}`}>
                        <div className="flex items-center gap-1.5">
                          <TimeSelect
                            value={block.startMinute}
                            invalid={Boolean(problem)}
                            onChange={(v) => updateBlock(block, "startMinute", v)}
                            label={`${short} block start`}
                          />
                          <span className="font-body text-[12px] shrink-0 text-ink-faint">–</span>
                          <TimeSelect
                            value={block.endMinute}
                            invalid={Boolean(problem)}
                            onChange={(v) => updateBlock(block, "endMinute", v)}
                            label={`${short} block end`}
                          />
                          <button
                            type="button"
                            onClick={() => removeBlock(block)}
                            className="press shrink-0"
                            aria-label={`Remove ${short} block`}
                          >
                            <X size={13} color="#B9CBDD" />
                          </button>
                        </div>
                        {problem && (
                          <p className="font-body text-[13.5px] mt-1 text-danger">
                            {problem.kind === "inverted"
                              ? "This block ends before it starts."
                              : "This overlaps an earlier block on the same day."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => addBlock(weekday)}
                  // Seven of these render at once, one per day; the visible label
                  // alone leaves them indistinguishable to a screen reader.
                  aria-label={`Add another ${short} block`}
                  className="flex items-center gap-1 mt-2 press"
                >
                  <Plus size={11} color="#3B9BE8" />
                  <span className="font-body text-[15px] font-medium text-sky-text">
                    Add another block
                  </span>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
  invalid,
  label,
}: {
  value: number;
  onChange: (minute: number) => void;
  invalid: boolean;
  label: string;
}) {
  // A stored time outside the picker's range would otherwise vanish silently.
  const options = SELECTABLE_HOURS.includes(value)
    ? SELECTABLE_HOURS
    : [...SELECTABLE_HOURS, value].sort((a, b) => a - b);

  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="font-body text-[14px] rounded-lg px-1.5 py-1.5 outline-none flex-1 min-w-0 text-navy"
      style={{ border: `1px solid ${invalid ? "#F5C4BC" : "#DCE7F2"}` }}
    >
      {options.map((minute) => (
        <option key={minute} value={minute}>
          {formatMinuteOfDay(minute)}
        </option>
      ))}
    </select>
  );
}
