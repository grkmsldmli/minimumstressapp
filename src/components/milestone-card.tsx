"use client";

import { Check } from "lucide-react";

import { MILESTONES, type MilestoneKey, type Party } from "@/lib/milestones";

/**
 * The moments so far, and the next one, on a screen somebody already visits.
 *
 * Not a progress bar. badge-card.tsx draws one of those and holds it back
 * until twenty-five sessions, for a good reason: "96 to go" means nothing to
 * somebody with four. These are discrete — each either happened or has not —
 * so showing an unearned one costs nothing and gives a new host something to
 * aim at on the day they arrive, which is the day the bar cannot help them.
 *
 * The running total sits above them, and it is the only line here that is
 * different on each side. A host is told what unused hours earned, because
 * that is what they came for; a practitioner is told what they have held,
 * because telling somebody how much they have spent is showing them a bill.
 */
export function MilestoneCard({
  party,
  earned,
  total,
}: {
  party: Party;
  earned: readonly MilestoneKey[];
  /** The one-line summary, or null before there is anything true to say. */
  total: string | null;
}) {
  const mine = MILESTONES.filter((m) => m.party === party);
  const done = new Set(earned);

  // Everything reached, plus the next one that is not — so there is always
  // somewhere to look forward to, and never a list of things left undone.
  const next = mine.find((m) => !done.has(m.key));
  const shown = mine.filter((m) => done.has(m.key) || m === next);

  if (shown.length === 0) return null;

  return (
    <div className="rounded-2xl p-4" style={{ border: "1px solid #E7EEF6" }}>
      {total && (
        <p className="font-display italic font-semibold text-[17px] leading-snug text-navy mb-3">
          {total}
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {shown.map((m) => {
          const reached = done.has(m.key);
          return (
            <div key={m.key} className="flex items-start gap-2.5">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  backgroundColor: reached ? "#EDF6FE" : "#F4F8FC",
                  border: `1px solid ${reached ? "#2578C2" : "#E7EEF6"}`,
                }}
              >
                {reached && <Check size={11} color="#2578C2" />}
              </span>
              <div className="min-w-0">
                <p
                  className="font-body font-medium text-[14.5px]"
                  style={{ color: reached ? "#16304E" : "#7A8AA0" }}
                >
                  {m.title}
                </p>
                <p
                  className="font-body font-normal text-[13.5px] leading-relaxed mt-0.5"
                  style={{ color: reached ? "#566D85" : "#9AA9BC" }}
                >
                  {m.meaning}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
