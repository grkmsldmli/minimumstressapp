"use client";

import { Building2, Users } from "lucide-react";

import type { AccountType } from "@/lib/domain";

/**
 * Which side of the marketplace this account is.
 *
 * Two people can be looking at screens that share a shell — a profile, a
 * booking list, a message thread — and the app never said which half they were
 * in. That matters more here than in most products because the choice is
 * permanent: somebody who cannot tell which account they signed in with cannot
 * tell why the app is refusing them a screen.
 *
 * The same icon and colour the choice was made with, so the badge reads as the
 * answer to a question they have already been asked rather than as new
 * vocabulary. Practitioner is the blue one with people in it; host is the
 * coral one with a building.
 */
const LOOK = {
  practitioner: {
    icon: Users,
    label: "Practitioner",
    ink: "#2670B0",
    fill: "#EDF6FE",
    line: "#D4E8FA",
    onDarkInk: "#8FC6F5",
  },
  host: {
    icon: Building2,
    label: "Host",
    ink: "#B45143",
    fill: "#FEF2F0",
    line: "#F5C4BC",
    onDarkInk: "#F2A79E",
  },
} as const;

export function AccountBadge({
  accountType,
  tone = "light",
}: {
  accountType: AccountType | null;
  /** Dark sits on the navy headers, where a filled pill would fight the panel. */
  tone?: "light" | "dark";
}) {
  // Nothing to state before the choice is made, and inventing a default here
  // would be the one place the app guesses at something it enforces.
  if (!accountType) return null;

  const look = LOOK[accountType];
  const Icon = look.icon;
  const dark = tone === "dark";

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-body font-medium text-[11.5px]"
      style={
        dark
          ? {
              backgroundColor: "rgba(255,255,255,0.12)",
              color: look.onDarkInk,
              border: "1px solid rgba(255,255,255,0.16)",
            }
          : { backgroundColor: look.fill, color: look.ink, border: `1px solid ${look.line}` }
      }
    >
      <Icon size={11} />
      {look.label}
    </span>
  );
}
