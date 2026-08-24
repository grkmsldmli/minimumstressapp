"use client";

import { AlertTriangle, Check, Info } from "lucide-react";
import { useState } from "react";

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
 * A calmer standing card: a positive headline and a one-line summary on a good
 * day, with the exact policy (rolling window, count, pause) kept a tap away
 * behind "View policy". Same rules, same data, same calculations as
 * StandingNotice — this only changes how they read when nothing is wrong, so a
 * healthy account is not shown the punishment maths it does not need.
 */
export function StandingSummary({ party, standing }: { party: Party; standing: Standing }) {
  const [showPolicy, setShowPolicy] = useState(false);
  const { suspendAt } = THRESHOLDS[party];

  const palette = {
    clear: { bg: "#EFF4EC", border: "#DCE6D6", text: "#4A5D4A", accent: "#557255", label: "Good standing", Icon: Check },
    warned: { bg: "#FFF8F1", border: "#F5DFC4", text: "#7A5B33", accent: "#8B6C37", label: "Heads up", Icon: Info },
    suspended: { bg: "#FEF2F0", border: "#F5C4BC", text: "#7A4A42", accent: "#B45143", label: "Bookings paused", Icon: AlertTriangle },
  }[standing.level];
  const Icon = palette.Icon;

  // Calm on a good day; the exceptional states show their real situation in full
  // (explainStanding names the date a pause lifts and how to contest it). The
  // count/pause numbers a healthy account does not need live under "View policy".
  const summary =
    standing.level === "clear"
      ? standing.lateCancellations === 0
        ? "No recent last-minute cancellations."
        : `${standing.lateCancellations} last-minute cancellation${standing.lateCancellations === 1 ? "" : "s"} in the last ${STANDING_WINDOW_DAYS} days.`
      : explainStanding(party, standing);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <div className="flex items-center gap-2">
        <Icon size={15} color={palette.accent} />
        <p className="font-body font-medium text-[14.5px]" style={{ color: palette.text }}>
          {palette.label}
        </p>
      </div>

      <p
        className="font-body font-normal text-[13.5px] leading-relaxed mt-1"
        style={{ color: palette.text }}
      >
        {summary}
      </p>

      <button
        type="button"
        onClick={() => setShowPolicy((v) => !v)}
        aria-expanded={showPolicy}
        className="font-body font-medium text-[13.5px] mt-2 press text-sky-text"
      >
        {showPolicy ? "Hide policy" : "View policy"}
      </button>

      {showPolicy && (
        <p className="font-body font-normal text-[13px] leading-relaxed mt-2 text-ink-faint">
          Last-minute cancellations are tracked over a rolling {STANDING_WINDOW_DAYS}-day period.{" "}
          {suspendAt} qualifying cancellations pause new bookings for {SUSPENSION_DAYS[party]} days.
        </p>
      )}
    </div>
  );
}

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
          className="font-body font-semibold text-[12px] uppercase tracking-[0.14em]"
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
            days, which pauses new bookings for {SUSPENSION_DAYS[party]} days. Sessions already
            booked still go ahead.
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
