"use client";

import { useState } from "react";
import { ArrowLeft, Award, Check, Trash2 } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PullToRefresh } from "@/components/pull-to-refresh";
import type { RosterMember } from "@/lib/domain";
import { type InviteControl, inviteControlState } from "@/lib/work/roster-invite";
import { GroupLabel } from "./practitioner-extras";

/** Invite mode: everything the card needs to show an invite control and act. */
export interface RosterInviteMode {
  /** Practitioner ids already invited to the current request (persisted state). */
  invitedIds: Set<string>;
  /** Practitioner ids whose invite is in flight — a set, so inviting a second
   *  member never releases the first member's lock. */
  busyIds: Set<string>;
  onInvite: (practitionerId: string) => void;
}

function InviteButton({ control, onInvite }: { control: InviteControl; onInvite: () => void }) {
  if (control === "invited") {
    return (
      <span
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-body font-medium text-[12.5px] shrink-0"
        style={{ backgroundColor: "#EFF4EC", color: "#557255" }}
      >
        <Check size={12} /> Invited
      </span>
    );
  }
  if (control === "unavailable") {
    return (
      <span
        className="px-3 py-1.5 rounded-full font-body font-medium text-[12.5px] shrink-0"
        style={{ backgroundColor: "#F4F8FC", color: "#8AA0B6" }}
      >
        Unavailable
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={control === "inviting"}
      onClick={onInvite}
      className="px-4 py-1.5 rounded-full font-body font-medium text-[12.5px] text-white press disabled:opacity-60 shrink-0"
      style={{ backgroundColor: "#2578C2" }}
    >
      {control === "inviting" ? "Inviting…" : "Invite"}
    </button>
  );
}

function MemberCard({
  member,
  invite,
  removing = false,
  onRemove,
}: {
  member: RosterMember;
  invite?: RosterInviteMode;
  removing?: boolean;
  onRemove?: (id: string) => void;
}) {
  const m = member;
  const control = invite
    ? inviteControlState(m, invite.invitedIds.has(m.practitionerId), invite.busyIds.has(m.practitionerId))
    : null;
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
      {invite && control ? (
        <InviteButton control={control} onInvite={() => invite.onInvite(m.practitionerId)} />
      ) : (
        <button
          type="button"
          onClick={() => onRemove?.(m.id)}
          disabled={removing}
          aria-label={`Remove ${m.displayName}`}
          className="w-8 h-8 rounded-full flex items-center justify-center press shrink-0 disabled:opacity-50"
          style={{ backgroundColor: "#FEF2F0" }}
        >
          <Trash2 size={14} color="#B45143" />
        </button>
      )}
    </div>
  );
}

export function RosterScreen({
  members,
  onRemove,
  invite,
  onRefresh,
  onBack,
}: {
  members: RosterMember[];
  /** Management mode: remove a member. Return the promise so the row can stay
   *  disabled until it settles. Ignored in invite mode. */
  onRemove?: (id: string) => void | Promise<unknown>;
  /** When set, the screen invites members to a request instead of managing them. */
  invite?: RosterInviteMode;
  onRefresh: () => Promise<unknown> | unknown;
  onBack: () => void;
}) {
  // In management mode, disable a member's Remove while its removal is in flight
  // so a double-tap can't fire two deletes.
  const [removingId, setRemovingId] = useState<string | null>(null);

  const hero = (
    <div
      className="-mx-6 px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
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
        <ArrowLeft size={17} color="#fff" />
      </button>
      <div className="mt-5 relative z-10">
        {invite ? (
          <Headline pre="Invite to" accent="cover." size={24} light />
        ) : (
          <Headline pre="My" accent="roster." size={24} light />
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <PullToRefresh header={hero} className="flex-1 px-6 pb-8 safe-pb-8" onRefresh={onRefresh}>
        <div className="mt-4" />
        <GroupLabel>{invite ? "Your trusted substitutes" : "Trusted substitutes"}</GroupLabel>
        {invite && (
          <p className="font-body font-normal text-[12.5px] text-ink-soft mb-3 -mt-1">
            An invite only lets them know — they still apply, and you still confirm. No one is
            auto-assigned.
          </p>
        )}
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
              invite={invite}
              removing={removingId === m.id}
              onRemove={
                onRemove
                  ? (id) => {
                      if (removingId) return;
                      setRemovingId(id);
                      Promise.resolve(onRemove(id)).finally(() => setRemovingId(null));
                    }
                  : undefined
              }
            />
          ))
        )}
      </PullToRefresh>
    </div>
  );
}
