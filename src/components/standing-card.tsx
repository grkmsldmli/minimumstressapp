"use client";

import { Award, ChevronRight } from "lucide-react";
import { useState } from "react";

import { type Party, TIERS, standingFor } from "@/lib/standing-points";

/**
 * Where somebody stands, and what it gets them.
 *
 * Framed as progress rather than a score. The same number can be read two
 * ways — "you have 40 points" invites comparison with somebody who has 400,
 * and "60 to go" invites another booking. Only one of those is useful to
 * either side of a marketplace where the people involved need each other.
 *
 * The full ladder is behind a tap. Somebody at the first tier reading four
 * levels they have not reached is being shown three ways to feel behind.
 */
export function StandingCard({ party, points }: { party: Party; points: number }) {
  const [showLadder, setShowLadder] = useState(false);
  const standing = standingFor(party, points);

  return (
    <div className="rounded-2xl p-4" style={{ border: "1px solid #E7EEF6" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Award size={15} color="#E8A33D" className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-body font-medium text-[13px] text-navy">{standing.tier.name}</p>
            <p className="font-body font-light text-[11.5px] mt-1 leading-relaxed text-ink-soft">
              {standing.tier.benefit}
            </p>
          </div>
        </div>
        <span className="font-body font-semibold text-[15px] text-navy shrink-0">{points}</span>
      </div>

      {standing.next ? (
        <div className="mt-3.5">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#EDF3F9" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${standing.progress * 100}%`,
                backgroundColor: "#3B9BE8",
                transition: "width 0.4s ease",
              }}
            />
          </div>
          <p className="font-body font-light text-[11px] mt-2 text-ink-faint">
            {standing.toNext} more to {standing.next.name} — {standing.next.benefit.toLowerCase()}
          </p>
        </div>
      ) : (
        <p className="font-body font-light text-[11px] mt-3 text-ink-faint">
          You&apos;re at the top. Thank you for the hours.
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowLadder((open) => !open)}
        className="w-full mt-3 flex items-center justify-between press"
      >
        <span className="font-body font-light text-[11.5px] text-sky">
          {showLadder ? "Hide" : "How this works"}
        </span>
        <ChevronRight
          size={13}
          color="#3B9BE8"
          style={{
            transform: showLadder ? "rotate(90deg)" : "none",
            transition: "transform 0.2s ease",
          }}
        />
      </button>

      {showLadder && (
        <div className="mt-3 flex flex-col gap-2.5">
          <p className="font-body font-light text-[11.5px] leading-relaxed text-ink-soft">
            Points come from sessions that actually happened and from what the other side said
            afterwards. Cancelling inside 24 hours costs more than a session earns, because
            somebody was left without a room.
          </p>

          {TIERS[party].map((tier) => {
            const reached = points >= tier.at;
            return (
              <div
                key={tier.key}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
                style={{
                  backgroundColor: reached ? "#F4F8FC" : "transparent",
                  border: `1px solid ${reached ? "#E7EEF6" : "#F0ECE0"}`,
                }}
              >
                <span
                  className="font-body font-medium text-[11px] shrink-0 mt-0.5"
                  style={{ color: reached ? "#16304E" : "#B0BFCF", minWidth: 30 }}
                >
                  {tier.at}
                </span>
                <div className="min-w-0">
                  <p
                    className="font-body font-medium text-[12px]"
                    style={{ color: reached ? "#16304E" : "#8CA3BD" }}
                  >
                    {tier.name}
                  </p>
                  <p className="font-body font-light text-[11px] mt-0.5 leading-relaxed text-ink-faint">
                    {tier.benefit}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
