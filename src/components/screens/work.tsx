"use client";

import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Clock,
  LayoutGrid,
  type LucideIcon,
  MapPin,
  Plus,
  ToggleLeft,
  ToggleRight,
  Users,
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
import { formatCents } from "@/lib/money";
import { professionLabel } from "@/lib/professions";
import { sessionDayShort, sessionTime, sessionZoneLabel } from "@/lib/when";
import { describeWorkGap, type WorkEligibilityGap } from "@/lib/work/eligibility";
import { effectiveRequestState, interestStateLabel, requestStateLabel } from "@/lib/work/request-state";
import { GroupLabel, ProfileRow } from "./practitioner-extras";

const NAVY = "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)";

/**
 * One tile in the practitioner Work action grid — a fixed-height, comfortable
 * touch target with an icon, a label, and a state/value line. Kept uniform so a
 * 2×2 (or, on a wide iPad, a single row) reads as one intentional grid rather
 * than buttons that happened to wrap.
 */
function ActionTile({
  icon: Icon,
  label,
  value,
  tone = "default",
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "default" | "on" | "off";
  onClick: () => void;
}) {
  const valueColor = tone === "on" ? "#557255" : tone === "off" ? "#8AA0B6" : "#2670B0";
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl bg-white p-3.5 text-left press flex flex-col justify-between min-h-[92px]"
      style={{ border: "1px solid #E7EEF6" }}
    >
      <Icon size={18} color="#8BA3BD" aria-hidden />
      <div className="mt-3">
        <p className="font-body font-medium text-[13px] text-navy leading-tight">{label}</p>
        <p className="font-body font-semibold text-[13.5px] mt-0.5" style={{ color: valueColor }}>
          {value}
        </p>
      </div>
    </button>
  );
}

/** Smoothly bring one of the Work sections into view when its tile is tapped. */
function scrollToSection(id: string): void {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
  canApply,
  onExpressInterest,
  onWithdrawInterest,
}: {
  opportunity: WorkOpportunity;
  busy: boolean;
  canApply: boolean;
  onExpressInterest: (requestId: string) => void;
  onWithdrawInterest: (interestId: string) => void;
}) {
  const o = opportunity;
  const live = o.state === "open" || o.state === "filled";
  const craft = professionLabel(o.profession);
  const formatLabel: Record<string, string> = {
    group: "Group",
    private: "Private 1:1",
    semiprivate: "Semi-private",
    workshop: "Workshop",
  };

  return (
    <div className="rounded-2xl bg-white p-4 mb-3" style={{ border: "1px solid #E7EEF6" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body font-semibold text-[15.5px] text-navy truncate">{o.title}</p>
          <p className="font-body font-normal text-[13px] text-ink-faint mt-0.5">
            {[o.sessionFormat ? formatLabel[o.sessionFormat] : null, craft, o.level]
              .filter(Boolean)
              .join(" · ") || "Coverage"}
          </p>
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

      {o.requiredQualifications.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {o.requiredQualifications.map((q) => (
            <span
              key={q}
              className="px-2 py-0.5 rounded-full font-body font-medium text-[11.5px]"
              style={{ backgroundColor: "#F4F8FC", color: "#566D85" }}
            >
              {q}
            </span>
          ))}
        </div>
      )}

      {o.notes && <p className="font-body font-normal text-[13.5px] text-ink-soft mt-3">{o.notes}</p>}

      <div className="flex items-center justify-between mt-3.5">
        <span className="font-display italic text-[17px] text-navy">
          {formatCents(o.payCents)}
        </span>
        {live && !o.interestState && canApply && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onExpressInterest(o.requestId)}
            className="px-4 py-2 rounded-full font-body font-medium text-[14px] text-white press disabled:opacity-60"
            style={{ backgroundColor: "#2578C2" }}
          >
            {busy ? "…" : "Apply"}
          </button>
        )}
        {live && !o.interestState && !canApply && (
          <span className="font-body font-normal text-[12.5px] text-ink-faint">Verify to apply</span>
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
  canBrowse,
  canApply,
  practitionerProActive,
  foundingProFreeUntil,
  now,
  gaps,
  preferences,
  availabilityCount,
  opportunities,
  busyRequestId,
  onToggleAvailable,
  onEditAvailability,
  onExpressInterest,
  onWithdrawInterest,
  onFixGap,
  onGoPro,
  onRefresh,
  onBack,
}: {
  /** Work Pro: may browse the whole open board (else only their own applications). */
  canBrowse: boolean;
  /** Pro AND a complete, verified profile: may apply to new coverage. */
  canApply: boolean;
  /** Pro is active (paid or founding free) — drives the PRO badge. */
  practitionerProActive: boolean;
  /** The end of the practitioner founding free period, when in one (for the reminder). */
  foundingProFreeUntil: Date | null;
  /** The render's clock, passed in so this stays a pure component. */
  now: Date;
  gaps: WorkEligibilityGap[];
  preferences: WorkPreferences;
  availabilityCount: number;
  opportunities: WorkOpportunity[];
  busyRequestId: string | null;
  onToggleAvailable: () => void;
  onEditAvailability: () => void;
  onExpressInterest: (requestId: string) => void;
  onWithdrawInterest: (interestId: string) => void;
  onFixGap: (gap: WorkEligibilityGap) => void;
  onGoPro: () => void;
  onRefresh: () => Promise<unknown> | unknown;
  onBack: () => void;
}) {
  // Rows the practitioner is engaged with are always theirs to manage, even
  // without Pro. Everything else on the list is the open board (Pro only).
  const myApplications = opportunities.filter(
    (o) => o.interestState === "interested" || o.interestState === "confirmed",
  );
  const boardOnly = opportunities.filter(
    (o) => !(o.interestState === "interested" || o.interestState === "confirmed"),
  );
  const freeDaysLeft =
    foundingProFreeUntil != null
      ? Math.max(0, Math.ceil((foundingProFreeUntil.getTime() - now.getTime()) / 86_400_000))
      : null;
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
        <div className="flex items-center gap-2">
          {practitionerProActive && (
            <span
              className="px-2 py-0.5 rounded-full font-body font-bold text-[11px] tracking-wide"
              style={{ backgroundColor: "rgba(255,255,255,0.16)", color: "#fff" }}
            >
              PRO
            </span>
          )}
          <AccountBadge accountType="practitioner" tone="dark" />
        </div>
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

        {/* A Founding Practitioner inside their free window — a gentle reminder,
            no card on file, nothing auto-charges. */}
        {practitionerProActive && freeDaysLeft != null && (
          <div
            className="rounded-2xl p-4 mb-4"
            style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
          >
            <p className="font-body font-medium text-[13.5px] text-navy">
              Pro is free for you — {freeDaysLeft} {freeDaysLeft === 1 ? "day" : "days"} left
            </p>
            <p className="font-body font-normal text-[12.5px] text-ink-soft mt-1">
              As a Founding Practitioner your first six months are on us. Nothing is charged, and it
              only continues if you choose to — at your permanent 50% rate.
            </p>
            <button
              type="button"
              onClick={onGoPro}
              className="mt-2 font-body font-medium text-[13px] text-sky-text press"
            >
              Continue at 50% →
            </button>
          </div>
        )}

        {/* A balanced 2×2 of the practitioner's Work actions — availability on/off
            and weekly hours are the real controls; applications and the board are
            quick jumps to the sections below. Four equal tiles so the top reads as
            one intentional grid, opening out to a single row on a wide iPad. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ActionTile
            icon={preferences.availableForWork ? ToggleRight : ToggleLeft}
            label="Available for work"
            value={preferences.availableForWork ? "On" : "Off"}
            tone={preferences.availableForWork ? "on" : "off"}
            onClick={onToggleAvailable}
          />
          <ActionTile
            icon={CalendarClock}
            label="Weekly hours"
            value={availabilityCount > 0 ? `${availabilityCount} set` : "Not set"}
            onClick={onEditAvailability}
          />
          <ActionTile
            icon={ClipboardList}
            label="My applications"
            value={String(myApplications.length)}
            onClick={() => scrollToSection("work-applications")}
          />
          <ActionTile
            icon={LayoutGrid}
            label="Coverage board"
            value={canBrowse ? `${boardOnly.length} open` : "Pro"}
            onClick={() => scrollToSection("work-board")}
          />
        </div>

        {/* Pro is what unlocks the board; verification is what unlocks applying.
            Two distinct gates, shown separately so neither reads as the other. */}
        {canBrowse && !canApply && (
          <div
            className="rounded-2xl p-4 mt-4"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            <p className="font-body font-medium text-[14px] text-navy">Finish your profile to apply</p>
            <p className="font-body font-normal text-[13px] text-ink-soft mt-1 mb-2.5">
              You can browse everything below. To apply, a studio needs to see a complete, verified
              profile — finish these and you&apos;re ready.
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

        {/* Existing applications are always the practitioner's to manage — shown
            whether or not they currently have Pro. */}
        {myApplications.length > 0 && (
          <div className="mt-6" id="work-applications">
            <GroupLabel>Your applications</GroupLabel>
            {myApplications.map((o) => (
              <OpportunityCard
                key={o.requestId}
                opportunity={o}
                canApply={canApply}
                busy={busyRequestId === o.requestId || (o.interestId != null && busyRequestId === o.interestId)}
                onExpressInterest={onExpressInterest}
                onWithdrawInterest={onWithdrawInterest}
              />
            ))}
          </div>
        )}

        <div className="mt-6" id="work-board">
          <GroupLabel>Coverage board</GroupLabel>
          {!canBrowse ? (
            <div
              className="rounded-2xl p-5"
              style={{ backgroundColor: "#F1F7FD", border: "1px solid #DCEAF7" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded-full font-body font-bold text-[11px] tracking-wide text-white"
                  style={{ backgroundColor: "#2578C2" }}
                >
                  PRO
                </span>
                <p className="font-body font-semibold text-[15px] text-navy">Browse coverage with Pro</p>
              </div>
              <p className="font-body font-normal text-[13.5px] text-ink-soft mt-2">
                Work Pro opens the coverage board — every open class studios near you need covered.
                Browse, filter, and apply on your terms. No ranking, no gatekeeping.
              </p>
              <div className="mt-3.5">
                <PrimaryButton onClick={onGoPro}>Go Pro</PrimaryButton>
              </div>
            </div>
          ) : boardOnly.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center"
              style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
            >
              <p className="font-display italic text-[16px] text-navy">Nothing open right now.</p>
              <p className="font-body font-normal text-[13.5px] text-ink-soft mt-1.5">
                New coverage shows up here as studios post it. Check back soon.
              </p>
            </div>
          ) : (
            boardOnly.map((o) => (
              <OpportunityCard
                key={o.requestId}
                opportunity={o}
                canApply={canApply}
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
  canPost,
  studioProActive,
  foundingFreeUntil,
  now,
  requests,
  templateCount,
  rosterCount,
  hasSpaces,
  onNewCoverage,
  onOpenTemplates,
  onOpenRoster,
  onOpenRequest,
  onGoStudioPro,
  onRefresh,
  onBack,
}: {
  /** Active Studio Pro (paid) or inside the Founding free period. */
  canPost: boolean;
  studioProActive: boolean;
  foundingFreeUntil: Date | null;
  /** The render's clock, passed in so this stays a pure component. */
  now: Date;
  requests: CoverageRequest[];
  templateCount: number;
  rosterCount: number;
  hasSpaces: boolean;
  onNewCoverage: () => void;
  onOpenTemplates: () => void;
  onOpenRoster: () => void;
  onOpenRequest: (id: string) => void;
  onGoStudioPro: () => void;
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
  const freeDaysLeft =
    foundingFreeUntil != null
      ? Math.max(0, Math.ceil((foundingFreeUntil.getTime() - now.getTime()) / 86_400_000))
      : null;

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
        <div className="flex items-center gap-2">
          {studioProActive && (
            <span
              className="px-2 py-0.5 rounded-full font-body font-bold text-[11px] tracking-wide"
              style={{ backgroundColor: "rgba(255,255,255,0.16)", color: "#fff" }}
            >
              STUDIO PRO
            </span>
          )}
          <AccountBadge accountType="host" tone="dark" />
        </div>
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

        {/* Studio Pro upsell for a host who cannot post — but their existing
            coverage history stays visible and read-only below. */}
        {!canPost && (
          <div
            className="rounded-2xl p-5 mb-4"
            style={{ backgroundColor: "#F1F7FD", border: "1px solid #DCEAF7" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded-full font-body font-bold text-[11px] tracking-wide text-white"
                style={{ backgroundColor: "#2578C2" }}
              >
                STUDIO PRO
              </span>
              <p className="font-body font-semibold text-[15px] text-navy">Post coverage with Studio Pro</p>
            </div>
            <p className="font-body font-normal text-[13.5px] text-ink-soft mt-2">
              One subscription covers every space you run. Post coverage, view applicants, confirm,
              keep class templates and a trusted roster.
            </p>
            <div className="mt-3.5">
              <PrimaryButton onClick={onGoStudioPro}>Get Studio Pro</PrimaryButton>
            </div>
          </div>
        )}

        {/* A Founding Host inside the free window — a gentle reminder, no card on
            file, nothing auto-charges. */}
        {canPost && !studioProActive && null}
        {studioProActive && freeDaysLeft != null && (
          <div
            className="rounded-2xl p-4 mb-4"
            style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
          >
            <p className="font-body font-medium text-[13.5px] text-navy">
              Studio Pro is free for you — {freeDaysLeft} {freeDaysLeft === 1 ? "day" : "days"} left
            </p>
            <p className="font-body font-normal text-[12.5px] text-ink-soft mt-1">
              As a Founding Host your first six months are on us. Nothing is charged, and it only
              continues if you choose to — at your permanent 50% rate.
            </p>
            <button
              type="button"
              onClick={onGoStudioPro}
              className="mt-2 font-body font-medium text-[13px] text-sky-text press"
            >
              Continue at 50% →
            </button>
          </div>
        )}

        <GroupLabel>Studio Pro tools</GroupLabel>
        <ProfileRow
          icon={LayoutGrid}
          label="Class templates"
          value={templateCount > 0 ? `${templateCount}` : "None yet"}
          onClick={onOpenTemplates}
        />
        <ProfileRow
          icon={Users}
          label="My Roster"
          value={rosterCount > 0 ? `${rosterCount}` : "Empty"}
          onClick={onOpenRoster}
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
            <GroupLabel>Coverage history</GroupLabel>
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
        <PrimaryButton onClick={canPost ? onNewCoverage : onGoStudioPro} disabled={!hasSpaces}>
          <span className="inline-flex items-center gap-1.5">
            {canPost ? (
              <>
                <Plus size={15} /> Post a coverage request
              </>
            ) : (
              "Get Studio Pro to post"
            )}
          </span>
        </PrimaryButton>
      </div>
    </div>
  );
}
