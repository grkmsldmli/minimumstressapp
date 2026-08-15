"use client";

import { Ambient, BreathingLogo, Headline } from "@/components/brand";
import { ConfettiBurst } from "@/components/primitives";
import type { Milestone } from "@/lib/milestones";

/**
 * The one moment worth taking the screen for.
 *
 * Exactly one per side — the first session — and the restriction is the point.
 * If arriving, listing, booking and being reviewed all stopped the app, none of
 * them would mean anything by the fourth. This is the one where something
 * actually happened rather than was arranged: a stranger came, the room worked,
 * nothing broke.
 *
 * Dismissing it writes the key to the profile, so it is seen once. Whether it
 * was *earned* is never stored — that is derived from bookings every time, so
 * it cannot drift from what happened.
 */
export function MilestoneMoment({
  milestone,
  onDone,
}: {
  milestone: Milestone;
  onDone: () => void;
}) {
  return (
    <div
      className="h-full flex flex-col items-center justify-center text-center px-9 screen-in relative overflow-hidden"
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, #1E4066 0%, #16304E 55%, #0E2138 100%)",
      }}
    >
      <Ambient />
      <ConfettiBurst />

      <div className="relative z-10 flex flex-col items-center">
        <BreathingLogo size={110} />

        <div className="mt-6">
          <Headline pre="" accent={milestone.title} size={26} light />
        </div>

        <p className="font-body font-normal text-[15px] text-white/70 leading-relaxed mt-3">
          {milestone.meaning}
        </p>

        <button
          type="button"
          onClick={onDone}
          className="mt-8 px-8 py-3.5 rounded-full font-body font-medium text-[15px] text-white press"
          style={{ backgroundColor: "#2578C2" }}
        >
          Thanks
        </button>
      </div>
    </div>
  );
}
