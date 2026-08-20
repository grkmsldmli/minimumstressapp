"use client";

import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Plus } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import type { HostBooking, HostSpace } from "@/lib/domain";
import { errorMessage } from "@/lib/error-message";
import { formatCents } from "@/lib/money";

/**
 * Every space a host has, and what each one is doing.
 *
 * Until now the only way to see a listing was to be looking at it: the
 * dashboard shows one space at a time and the switcher above it only appears
 * with two or more, so a host with a single hidden space came back to a screen
 * that looked entirely normal and no explanation for why nothing was booking.
 *
 * Hiding lived three taps deep inside Edit, which is the wrong place for it —
 * it is not an edit, it is the switch that decides whether the space exists
 * for anybody else.
 */

export function HostSpaces({
  spaces,
  bookings,
  onBack,
  onOpenSpace,
  onAddSpace,
  onSetListed,
}: {
  spaces: HostSpace[];
  bookings: HostBooking[];
  onBack: () => void;
  onOpenSpace: (spaceId: string) => void;
  onAddSpace: () => void;
  /** Rejects when the change does not save, so the row can say so. */
  onSetListed: (spaceId: string, listed: boolean) => Promise<unknown>;
}) {
  const now = new Date();

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="mt-3 relative z-10">
          <Headline pre="Your" accent="spaces." size={24} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <div className="flex flex-col gap-2.5">
          {spaces.map((space) => (
            <SpaceRow
              key={space.id}
              space={space}
              upcoming={
                bookings.filter(
                  (booking) =>
                    booking.spaceId === space.id &&
                    booking.status === "upcoming" &&
                    booking.startsAt >= now,
                ).length
              }
              onOpen={() => onOpenSpace(space.id)}
              onSetListed={(listed) => onSetListed(space.id, listed)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onAddSpace}
          className="w-full mt-4 py-3.5 rounded-xl font-body font-medium text-[15px] press flex items-center justify-center gap-2"
          style={{ border: "1px solid #D6E6F5", color: "#2578C2" }}
        >
          <Plus size={15} /> Add another space
        </button>
      </div>
    </div>
  );
}

function SpaceRow({
  space,
  upcoming,
  onOpen,
  onSetListed,
}: {
  space: HostSpace;
  upcoming: number;
  onOpen: () => void;
  onSetListed: (listed: boolean) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hidden = space.status === "delisted";
  const pending = space.status === "pending";

  const toggle = () => {
    setError(null);
    setBusy(true);
    void onSetListed(hidden)
      .catch((cause) =>
        setError(errorMessage(cause, hidden ? "Could not show it again." : "Could not hide it.")),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-2xl p-4" style={{ border: "1px solid #F0ECE0" }}>
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="text-left min-w-0 flex-1 press">
          <p className="font-body font-medium text-[15.5px] text-navy truncate">{space.name}</p>
          <p className="font-body font-normal text-[13.5px] text-ink-faint mt-0.5 truncate">
            {space.addressLine}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge
              label={hidden ? "Hidden" : pending ? "In review" : "Live"}
              tone={hidden ? "muted" : pending ? "warn" : "good"}
            />
            <span className="font-body font-normal text-[13px] text-ink-faint">
              {formatCents(space.hourlyRateCents)}/hr
            </span>
            <span className="font-body font-normal text-[13px] text-ink-faint">
              {/*
                Upcoming rather than total. A host opening this is deciding
                what to do next, and a lifetime count does not help with that
                — but "3 booked" tells them hiding it has consequences.
              */}
              {upcoming === 0 ? "Nothing booked" : `${upcoming} booked`}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={toggle}
          disabled={busy || pending}
          aria-label={hidden ? `Show ${space.name} again` : `Hide ${space.name}`}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center press disabled:opacity-40"
          style={{ border: "1px solid #E7EEF6" }}
        >
          {hidden ? <Eye size={16} color="#2578C2" /> : <EyeOff size={16} color="#7A8AA0" />}
        </button>
      </div>

      {hidden && (
        <p className="font-body font-normal text-[13px] leading-relaxed mt-2.5 text-ink-soft">
          Nobody can find or book this.
        </p>
      )}

      {error && (
        <p className="font-body font-normal text-[13px] mt-2 text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: "good" | "warn" | "muted" }) {
  const style = {
    good: { backgroundColor: "#EDF6FE", color: "#2578C2" },
    warn: { backgroundColor: "#FFF8F1", color: "#8B6C37" },
    muted: { backgroundColor: "#F1F3F6", color: "#6B7684" },
  }[tone];

  return (
    <span
      className="font-body font-medium text-[12px] px-2 py-0.5 rounded-full"
      style={style}
    >
      {label}
    </span>
  );
}
