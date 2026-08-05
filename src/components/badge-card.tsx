"use client";

import { Award } from "lucide-react";

import { type Party, badgesFor } from "@/lib/badges";

/**
 * Sessions run, and the badges they have earned.
 *
 * Recognition only — no fee changes, no rule bends, nothing to reconcile. It
 * replaced a points system whose tiers granted real benefits, and the reason
 * is worth keeping: each of those benefits was a rule that had to be explained
 * and reasoned about at the moment somebody was trying to book a room, and
 * none of them made the marketplace work better.
 *
 * Nothing is shown until the first one is close. Somebody with four sessions
 * reading "96 to go" has been handed a number that means nothing yet, and the
 * screen is more useful without it.
 */
const SHOW_PROGRESS_FROM = 25;

export function BadgeCard({ party, sessions }: { party: Party; sessions: number }) {
  const progress = badgesFor(party, sessions);

  if (progress.earned.length === 0 && sessions < SHOW_PROGRESS_FROM) return null;

  return (
    <div className="rounded-2xl p-4" style={{ border: "1px solid #E7EEF6" }}>
      <div className="flex items-start gap-2.5">
        <Award size={15} color="#E8A33D" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-body font-medium text-[14.5px] text-navy">
            {sessions} {sessions === 1 ? "session" : "sessions"}
          </p>

          {progress.earned.length > 0 ? (
            <p className="font-body font-normal text-[14px] mt-1 leading-relaxed text-ink-soft">
              {progress.earned[progress.earned.length - 1].meaning}
            </p>
          ) : (
            <p className="font-body font-normal text-[14px] mt-1 leading-relaxed text-ink-soft">
              {progress.toNext} more to your first badge.
            </p>
          )}
        </div>
      </div>

      {progress.earned.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {progress.earned.map((badge) => (
            <span
              key={badge.key}
              className="px-2.5 py-1 rounded-full font-body font-medium text-[13.5px]"
              style={{ backgroundColor: "#FDF6EA", color: "#8A5F1B" }}
            >
              {badge.name}
            </span>
          ))}
        </div>
      )}

      {progress.next && progress.earned.length > 0 && (
        <p className="font-body font-normal text-[13.5px] mt-2.5 text-ink-faint">
          {progress.toNext} more to {progress.next.name}.
        </p>
      )}
    </div>
  );
}
