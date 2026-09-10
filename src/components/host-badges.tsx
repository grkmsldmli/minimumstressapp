import { Award } from "lucide-react";

import { FOUNDING_HOST_LABEL } from "@/lib/founding";
import { sessionMilestoneLabel } from "@/lib/host-achievements";

/**
 * The two host signals a practitioner is shown, and only these two.
 *
 * Founding Host, and the highest completed-session milestone the host's rooms
 * have reached. Both arrive on the PublicSpace from the `public_host_profiles`
 * view (migration 0060) — the milestone as a bucket, never an exact count — so
 * this component only ever renders what the server already decided was safe to
 * show. It holds no name, no volume, no verdict.
 *
 * Deliberately restrained: at most two small chips, so a listing card stays
 * about the room. The `compact` variant is for a browse card, where a single
 * line of chips is all there is room for; the fuller variant is for the listing
 * detail, where a short labelled row can breathe. Nothing renders at all when a
 * host has neither signal — an absent badge, not an empty one.
 */
export function HostBadges({
  space,
  variant = "compact",
}: {
  space: { hostFoundingHost: boolean; hostSessionMilestone: number };
  variant?: "compact" | "detail";
}) {
  const milestone = sessionMilestoneLabel(space.hostSessionMilestone);
  const founding = space.hostFoundingHost;
  if (!founding && !milestone) return null;

  if (variant === "detail") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {founding && (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{ backgroundColor: "#EEF4FA", border: "1px solid #DEEAF5" }}
          >
            <Award size={13} color="#2E7CC4" />
            <span className="font-body font-medium text-[13px] text-navy">
              {FOUNDING_HOST_LABEL}
            </span>
          </span>
        )}
        {milestone && (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{ backgroundColor: "#EEF4FA", border: "1px solid #DEEAF5" }}
          >
            <span className="font-body font-medium text-[13px] text-navy">
              {milestone} hosted
            </span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {founding && (
        <span className="inline-flex items-center gap-1 font-body font-medium text-[12px] text-sky-text">
          <Award size={12} color="#2E7CC4" />
          {FOUNDING_HOST_LABEL}
        </span>
      )}
      {founding && milestone && (
        <span className="text-ink-faint text-[12px]" aria-hidden>
          ·
        </span>
      )}
      {milestone && (
        <span className="font-body font-medium text-[12px] text-ink-soft">
          {milestone} hosted
        </span>
      )}
    </div>
  );
}
