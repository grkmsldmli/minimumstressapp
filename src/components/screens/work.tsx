"use client";

import {
  ArrowLeft,
  Award,
  CalendarClock,
  ChevronRight,
  Clock,
  LayoutGrid,
  MapPin,
  Plus,
} from "lucide-react";

import { AccountBadge } from "@/components/account-badge";
import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import { PullToRefresh } from "@/components/pull-to-refresh";
import type {
  CoverageRequest,
  WorkOpportunity,
  WorkPreferences,
} from "@/lib/domain";
import { FOUNDING_PRACTITIONER_LABEL, foundingPractitionerSpotsRemainingLabel } from "@/lib/founding";
import { formatCents } from "@/lib/money";
import { professionLabel } from "@/lib/professions";
import { sessionDayShort, sessionTime, sessionZoneLabel } from "@/lib/when";
import { describeWorkGap, type WorkEligibilityGap } from "@/lib/work/eligibility";
import { effectiveRequestState, interestStateLabel, requestStateLabel } from "@/lib/work/request-state";
import { GroupLabel, ProfileRow, SettingToggle } from "./practitioner-extras";

const NAVY = "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)";

function whenLabel(startsAt: Date, timeZone: string): string {
  const zone = sessionZoneLabel(startsAt, timeZone);
  return `${sessionDayShort(startsAt, timeZone)} · ${sessionTime(startsAt, timeZone)}${zone ? ` ${zone}` : ""}`;
}

function StatePill({ label, tone }: { label: string; tone: "sky" | "positive" | "muted" | "coral" }) {
  const styles: Record<typeof tone, { bg: string; fg: string }> = {
    sky: { bg: "#EDF6FE", fg: "#2670B0" },
    positive: { bg: "#EFF4EC", fg: "#557255" },
    muted: { bg: "#F4F8FC", fg: "#566D85" },
    coral: { bg: "#FEF2F0", fg: "#B45143" },
  };
  const s = styles[tone];
  return (
    <span
      className="px-2.5 py-1 rounded-full font-body font-medium text-[12px] shrink-0"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {label}
    </span>
  );
}

/* ================================ Practitioner ================================ */

function OpportunityCard({
  opportunity,
  busy,
  onExpressInterest,
  onWithdrawInterest,
}: {
  opportunity: WorkOpportunity;
  busy: boolean;
  onExpressInterest: (requestId: string) => void;
  onWithdrawInterest: (interestId: string) => void;
}) {
  const o = opportunity;
  const live = o.state === "open" || o.state === "filled";
  const craft = professionLabel(o.profession);

  return (
    <div className="rounded-2xl bg-white p-4 mb-3" style={{ border: "1px solid #E7EEF6" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body font-semibold text-[15.5px] text-navy truncate">{o.title}</p>
          {craft && <p className="font-body font-normal text-[13px] text-ink-faint mt-0.5">{craft}</p>}
        </div>
        {o.urgent && live && <StatePill label="Urgent" tone="coral" />}
        {o.interestState === "confirmed" && <StatePill label="Confirmed" tone="positive" />}
        {o.interestState === "interested" && <StatePill label="Pending" tone="sky" />}
        {o.interestState === "declined" && <StatePill label={interestStateLabel("declined")} tone="muted" />}
        {!o.interestState && o.state !== "open" && (
          <StatePill label={requestStateLabel(o.state)} tone="muted" />
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
          <CalendarClock size={13} color="#8BA3BD" /> {whenLabel(o.startsAt, o.timeZone)}
        </span>
        <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
          <Clock size={13} color="#8BA3BD" />
          {Math.round((o.endsAt.getTime() - o.startsAt.getTime()) / 60000)} min
        </span>
        {(o.spaceName || o.area) && (
          <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
            <MapPin size={13} color="#8BA3BD" />
            {[o.spaceName, o.area].filter(Boolean).join(" · ")}
            {o.distanceLabel ? ` (${o.distanceLabel})` : ""}
          </span>
        )}
      </div>

      {o.notes && <p className="font-body font-normal text-[13.5px] text-ink-soft mt-3">{o.notes}</p>}

      <div className="flex items-center justify-between mt-3.5">
        <span className="font-display italic text-[17px] text-navy">
          {formatCents(o.payCents)}
        </span>
        {live && !o.interestState && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onExpressInterest(o.requestId)}
            className="px-4 py-2 rounded-full font-body font-medium text-[14px] text-white press disabled:opacity-60"
            style={{ backgroundColor: "#2578C2" }}
          >
            {busy ? "…" : "I'm available"}
          </button>
        )}
        {live && (o.interestState === "interested" || o.interestState === "confirmed") && o.interestId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onWithdrawInterest(o.interestId!)}
            className="px-4 py-2 rounded-full font-body font-medium text-[14px] press disabled:opacity-60"
            style={{ backgroundColor: "#F4F8FC", color: "#566D85" }}
          >
            {busy ? "…" : "Withdraw"}
          </button>
        )}
      </div>
    </div>
  );
}

export function WorkPractitioner({
  eligible,
  gaps,
  preferences,
  availabilityCount,
  opportunities,
  foundingNumber,
  foundingRemaining,
  busyRequestId,
  onToggleAvailable,
  onEditAvailability,
  onExpressInterest,
  onWithdrawInterest,
  onFixGap,
  onRefresh,
  onBack,
}: {
  eligible: boolean;
  gaps: WorkEligibilityGap[];
  preferences: WorkPreferences;
  availabilityCount: number;
  opportunities: WorkOpportunity[];
  foundingNumber: number | null;
  foundingRemaining: number;
  busyRequestId: string | null;
  onToggleAvailable: () => void;
  onEditAvailability: () => void;
  onExpressInterest: (requestId: string) => void;
  onWithdrawInterest: (interestId: string) => void;
  onFixGap: (gap: WorkEligibilityGap) => void;
  onRefresh: () => Promise<unknown> | unknown;
  onBack: () => void;
}) {
  const hero = (
    <div
      className="-mx-6 px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
      style={{ background: NAVY }}
    >
      <Ambient />
      <div className="flex items-center justify-between relative z-10">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={17} color="#fff" />
        </button>
        <AccountBadge accountType="practitioner" tone="dark" />
      </div>
      <div className="mt-6 relative z-10">
        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
          Work
        </p>
        <div className="mt-1">
          <Headline pre="Available for" accent="work." size={26} light />
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <PullToRefresh header={hero} className="flex-1 px-6 pb-8 safe-pb-8" onRefresh={onRefresh}>
        <div className="mt-4" />

        {foundingNumber !== null ? (
          <div className="flex items-center gap-2 mb-4">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: "#F1F7FD" }}
            >
              <Award size={14} color="#2E7CC4" />
            </span>
            <span className="font-body font-medium text-[13.5px] text-navy">
              {FOUNDING_PRACTITIONER_LABEL}
            </span>
          </div>
        ) : (
          foundingRemaining > 0 && (
            <p className="font-body font-normal text-[13px] text-ink-soft mb-4">
              {foundingPractitionerSpotsRemainingLabel(foundingRemaining)}.
            </p>
          )
        )}

        <SettingToggle
          label="Available for work"
          sub="Studios can find you for coverage that fits"
          on={preferences.availableForWork}
          onToggle={onToggleAvailable}
        />

        {!eligible && preferences.availableForWork && (
          <div
            className="rounded-2xl p-4 mt-3"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            <p className="font-body font-medium text-[14px] text-navy">
              You&apos;re not matchable yet
            </p>
            <p className="font-body font-normal text-[13px] text-ink-soft mt-1 mb-2.5">
              Studios only see professionals with a complete, verified profile. Finish these and
              you&apos;ll start appearing.
            </p>
            {gaps.map((gap) => {
              const g = describeWorkGap(gap);
              return (
                <button
                  key={gap}
                  type="button"
                  onClick={() => onFixGap(gap)}
                  className="w-full flex items-center justify-between py-2 press text-left"
                >
                  <span className="font-body font-medium text-[13.5px]" style={{ color: "#8B6C37" }}>
                    {g.title}
                  </span>
                  <span className="inline-flex items-center gap-1 font-body font-medium text-[13px] text-sky-text">
                    {g.cta} <ChevronRight size={13} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-6">
          <GroupLabel>Availability</GroupLabel>
          <ProfileRow
            icon={CalendarClock}
            label="Weekly availability"
            value={availabilityCount > 0 ? `${availabilityCount} set` : "Not set"}
            onClick={onEditAvailability}
          />
        </div>

        <div className="mt-6">
          <GroupLabel>Opportunities</GroupLabel>
          {opportunities.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center"
              style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
            >
              <p className="font-display italic text-[16px] text-navy">No opportunities yet.</p>
              <p className="font-body font-normal text-[13.5px] text-ink-soft mt-1.5">
                Keep Available for Work on and we&apos;ll surface relevant requests here.
              </p>
            </div>
          ) : (
            opportunities.map((o) => (
              <OpportunityCard
                key={o.requestId}
                opportunity={o}
                busy={busyRequestId === o.requestId || (o.interestId != null && busyRequestId === o.interestId)}
                onExpressInterest={onExpressInterest}
                onWithdrawInterest={onWithdrawInterest}
              />
            ))
          )}
        </div>
      </PullToRefresh>
    </div>
  );
}

/* ================================ Studio ================================ */

function CoverageRow({
  request,
  onOpen,
}: {
  request: CoverageRequest;
  onOpen: (id: string) => void;
}) {
  const state = effectiveRequestState(request);
  const receiving = state === "open" && request.interestCount > 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(request.id)}
      className="w-full text-left rounded-2xl bg-white p-4 mb-3 press"
      style={{ border: "1px solid #E7EEF6" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body font-semibold text-[15.5px] text-navy truncate">{request.title}</p>
          <p className="font-body font-normal text-[13px] text-ink-faint mt-0.5">
            {whenLabel(request.startsAt, request.timeZone)}
          </p>
        </div>
        {state === "filled" ? (
          <StatePill label="Filled" tone="positive" />
        ) : receiving ? (
          <StatePill label={`${request.interestCount} interested`} tone="sky" />
        ) : state === "open" ? (
          <StatePill label="Open" tone="muted" />
        ) : (
          <StatePill label={requestStateLabel(state)} tone="muted" />
        )}
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="font-display italic text-[16px] text-navy">{formatCents(request.payCents)}</span>
        <ChevronRight size={16} color="#B9CBDD" />
      </div>
    </button>
  );
}

export function WorkStudio({
  requests,
  templateCount,
  hasSpaces,
  onNewCoverage,
  onOpenTemplates,
  onOpenRequest,
  onRefresh,
  onBack,
}: {
  requests: CoverageRequest[];
  templateCount: number;
  hasSpaces: boolean;
  onNewCoverage: () => void;
  onOpenTemplates: () => void;
  onOpenRequest: (id: string) => void;
  onRefresh: () => Promise<unknown> | unknown;
  onBack: () => void;
}) {
  const active = requests.filter((r) => {
    const s = effectiveRequestState(r);
    return s === "open" || s === "filled";
  });
  const past = requests.filter((r) => {
    const s = effectiveRequestState(r);
    return s === "completed" || s === "cancelled" || s === "expired";
  });

  const hero = (
    <div
      className="-mx-6 px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
      style={{ background: NAVY }}
    >
      <Ambient />
      <div className="flex items-center justify-between relative z-10">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={17} color="#fff" />
        </button>
        <AccountBadge accountType="host" tone="dark" />
      </div>
      <div className="mt-6 relative z-10">
        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
          Work
        </p>
        <div className="mt-1">
          <Headline pre="Need" accent="coverage?" size={26} light />
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <PullToRefresh header={hero} className="flex-1 px-6 pb-8 safe-pb-8" onRefresh={onRefresh}>
        <div className="mt-4" />

        {!hasSpaces && (
          <div
            className="rounded-2xl p-4 mb-4"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            <p className="font-body font-medium text-[14px] text-navy">List a space first</p>
            <p className="font-body font-normal text-[13px] text-ink-soft mt-1">
              Coverage happens in a room. Add a space, then post a class you need covered.
            </p>
          </div>
        )}

        <GroupLabel>Class templates</GroupLabel>
        <ProfileRow
          icon={LayoutGrid}
          label="Manage templates"
          value={templateCount > 0 ? `${templateCount}` : "None yet"}
          onClick={onOpenTemplates}
        />

        <div className="mt-6">
          <GroupLabel>Coverage requests</GroupLabel>
          {active.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center"
              style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
            >
              <p className="font-display italic text-[16px] text-navy">Need coverage?</p>
              <p className="font-body font-normal text-[13.5px] text-ink-soft mt-1.5">
                Post a class and reach available professionals who match what you need.
              </p>
            </div>
          ) : (
            active.map((r) => <CoverageRow key={r.id} request={r} onOpen={onOpenRequest} />)
          )}
        </div>

        {past.length > 0 && (
          <div className="mt-6">
            <GroupLabel>Past &amp; closed</GroupLabel>
            {past.map((r) => (
              <CoverageRow key={r.id} request={r} onOpen={onOpenRequest} />
            ))}
          </div>
        )}
      </PullToRefresh>

      <div
        className="px-6 pt-3 pb-6 safe-pb-6 shrink-0"
        style={{ borderTop: "1px solid #F0ECE0" }}
      >
        <PrimaryButton onClick={onNewCoverage} disabled={!hasSpaces}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={15} /> Post a coverage request
          </span>
        </PrimaryButton>
      </div>
    </div>
  );
}
