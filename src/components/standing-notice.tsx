"use client";

import { AlertTriangle, Check, Info } from "lucide-react";

import {
  LATE_CANCELLATION_HOURS,
  STANDING_WINDOW_DAYS,
  SUSPENSION_DAYS,
  THRESHOLDS,
  type Party,
  type Standing,
  explainStanding,
} from "@/lib/reliability";

/**
 * Where someone stands.
 *
 * Shown permanently rather than only once something has gone wrong, so the
 * count is checkable before it matters rather than announced on the day it
 * costs something.
 */
export function StandingNotice({ party, standing }: { party: Party; standing: Standing }) {
  const palette = {
    clear: { bg: "#EFF4EC", border: "#DCE6D6", text: "#4A5D4A", accent: "#557255" },
    warned: { bg: "#FFF8F1", border: "#F5DFC4", text: "#7A5B33", accent: "#8B6C37" },
    suspended: { bg: "#FEF2F0", border: "#F5C4BC", text: "#7A4A42", accent: "#B45143" },
  }[standing.level];

  const Icon =
    standing.level === "clear" ? Check : standing.level === "warned" ? Info : AlertTriangle;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} color={palette.accent} />
        <p
          className="font-body font-medium text-[11px] uppercase tracking-[0.14em]"
          style={{ color: palette.accent }}
        >
          {standing.level === "clear"
            ? "Standing"
            : standing.level === "warned"
              ? "Standing — heads up"
              : "Bookings paused"}
        </p>
      </div>

      <p
        className="font-body font-normal text-[14px] leading-relaxed mt-2"
        style={{ color: palette.text }}
      >
        {explainStanding(party, standing)}
      </p>
    </div>
  );
}

/**
 * The count, at the point of cancelling inside the window.
 *
 * Stating it here rather than afterwards is the difference between a rule and
 * a penalty nobody was told about.
 */
export function CancellationConsequence({
  party,
  standing,
}: {
  party: Party;
  standing: Standing;
}) {
  const { suspendAt } = THRESHOLDS[party];
  const after = standing.lateCancellations + 1;
  const willSuspend = after >= suspendAt;

  return (
    <div
      className="rounded-xl p-3 mt-2"
      style={{
        backgroundColor: willSuspend ? "#FEF2F0" : "#FFF8F1",
        border: `1px solid ${willSuspend ? "#F5C4BC" : "#F5DFC4"}`,
      }}
    >
      <p
        className="font-body font-normal text-[13.5px] leading-relaxed"
        style={{ color: willSuspend ? "#7A4A42" : "#7A5B33" }}
      >
        {willSuspend ? (
          <>
            This would be your {ordinal(after)} last-minute cancellation in {STANDING_WINDOW_DAYS}{" "}
            days, which pauses new bookings for {SUSPENSION_DAYS} days. Sessions already booked
            still go ahead.
          </>
        ) : (
          <>
            Cancelling within {LATE_CANCELLATION_HOURS} hours counts towards your standing —{" "}
            {after} of {suspendAt} in {STANDING_WINDOW_DAYS} days.
          </>
        )}
      </p>
    </div>
  );
}

function ordinal(n: number): string {
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}
