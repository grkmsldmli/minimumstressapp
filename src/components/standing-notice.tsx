"use client";

import { AlertTriangle, Check, Info } from "lucide-react";

import {
  STANDING_WINDOW_DAYS,
  SUSPENSION_DAYS,
  THRESHOLDS,
  type Party,
  type Standing,
  explainStanding,
} from "@/lib/reliability";

/**
 * Where someone stands, shown to them.
 *
 * A rule nobody can see is not a rule, it is a trap that springs later. This
 * sits on the profile permanently — not only once something has gone wrong —
 * so the answer to "where am I" is always one tap away rather than a surprise
 * on the day it costs something.
 */
export function StandingNotice({ party, standing }: { party: Party; standing: Standing }) {
  const palette = {
    clear: { bg: "#EFF4EC", border: "#DCE6D6", text: "#4A5D4A", accent: "#5E7D5E" },
    warned: { bg: "#FFF8F1", border: "#F5DFC4", text: "#7A5B33", accent: "#B08D4F" },
    suspended: { bg: "#FEF2F0", border: "#F5C4BC", text: "#7A4A42", accent: "#C05A4B" },
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
          className="font-body font-medium text-[10.5px] uppercase tracking-[0.14em]"
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
        className="font-body font-light text-[11.5px] leading-relaxed mt-2"
        style={{ color: palette.text }}
      >
        {explainStanding(party, standing)}
      </p>
    </div>
  );
}

/**
 * The rule itself, in the flow where it starts to apply.
 *
 * Shown when someone is about to cancel inside the window — the one moment
 * they can still change their mind, and the only honest time to mention that
 * it counts.
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
        className="font-body font-light text-[11px] leading-relaxed"
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
            Cancelling this close counts towards your standing — {after} of {suspendAt} in{" "}
            {STANDING_WINDOW_DAYS} days. {party === "host"
              ? "Someone has planned their day around this room."
              : "The host set this hour aside and turned other bookings away."}
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
