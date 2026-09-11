"use client";

import { useState } from "react";
import { ArrowLeft, Award, Check, Trash2 } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PullToRefresh } from "@/components/pull-to-refresh";
import type { RosterMember } from "@/lib/domain";
import { GroupLabel } from "./practitioner-extras";

const NAVY = "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)";

function MemberCard({
  member,
  busy,
  onRemove,
}: {
  member: RosterMember;
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  const m = member;
  return (
    <div className="rounded-2xl bg-white p-4 mb-3 flex items-start gap-3" style={{ border: "1px solid #E7EEF6" }}>
      {m.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-body font-semibold text-[15px]"
          style={{ backgroundColor: "#EDF6FE", color: "#2670B0" }}
        >
          {m.displayName.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="font-body font-semibold text-[15px] text-navy truncate">{m.displayName}</p>
          {m.foundingPractitioner && <Award size={13} color="#2E7CC4" />}
        </div>
        <p className="font-body font-normal text-[13px] text-ink-faint">{m.craft}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          <span className="font-body text-[12px] text-ink-soft">
            {m.timesWorkedTogether} {m.timesWorkedTogether === 1 ? "cover" : "covers"} together
          </span>
          {m.availableForWork && (
            <span className="inline-flex items-center gap-1 font-body text-[12px]" style={{ color: "#557255" }}>
              <Check size={11} /> Available
            </span>
          )}
        </div>
        {m.note && <p className="font-body font-normal text-[13px] text-ink-soft mt-2">{m.note}</p>}
      </div>
      <button
        type="button"
        onClick={() => onRemove(m.id)}
        disabled={busy}
        aria-label={`Remove ${m.displayName}`}
        className="w-8 h-8 rounded-full flex items-center justify-center press shrink-0 disabled:opacity-50"
        style={{ backgroundColor: "#FEF2F0" }}
      >
        <Trash2 size={14} color="#B45143" />
      </button>
    </div>
  );
}

export function RosterScreen({
  members,
  onRemove,
  onRefresh,
  onBack,
}: {
  members: RosterMember[];
  onRemove: (id: string) => void;
  onRefresh: () => Promise<unknown> | unknown;
  onBack: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const hero = (
    <div
      className="-mx-6 px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
      style={{ background: NAVY }}
    >
      <Ambient />
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
        style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
      >
        <ArrowLeft size={17} color="#fff" />
      </button>
      <div className="mt-5 relative z-10">
        <Headline pre="My" accent="roster." size={24} light />
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <PullToRefresh header={hero} className="flex-1 px-6 pb-8 safe-pb-8" onRefresh={onRefresh}>
        <div className="mt-4" />
        <GroupLabel>Trusted substitutes</GroupLabel>
        {members.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-center"
            style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
          >
            <p className="font-display italic text-[16px] text-navy">No one on your roster yet.</p>
            <p className="font-body font-normal text-[13.5px] text-ink-soft mt-1.5">
              After you confirm a professional for a class, you can keep them here and invite them to
              future coverage. An invite only notifies them — they still apply the normal way.
            </p>
          </div>
        ) : (
          members.map((m) => (
            <MemberCard
              key={m.id}
              member={m}
              busy={busyId === m.id}
              onRemove={(id) => {
                setBusyId(id);
                Promise.resolve(onRemove(id)).finally(() => setBusyId(null));
              }}
            />
          ))
        )}
      </PullToRefresh>
    </div>
  );
}
