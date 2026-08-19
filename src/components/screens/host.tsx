"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  MessageCircle,
  Building2,
  ChevronRight,
  LogOut,
  Plus,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";

import { AccountBadge } from "@/components/account-badge";
import { DeleteAccount } from "@/components/delete-account";
import { DocumentStatus } from "@/components/document-status";
import { EmergencyContactCard } from "@/components/emergency-contact";
import { BadgeCard } from "@/components/badge-card";
import { MilestoneCard } from "@/components/milestone-card";
import { Ambient, Headline, LogoBadge } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import { RequestQueue } from "@/components/request-queue";
import { StandingNotice } from "@/components/standing-notice";
import { WeekSchedule } from "@/components/week-schedule";
import type { AvailabilityBlock } from "@/lib/availability";
import type { BookingRequest, HostBooking, HostSpace, Profile } from "@/lib/domain";
import { errorMessage } from "@/lib/error-message";
import { formatCents } from "@/lib/money";
import { PAYOUT_DELAY_DAYS, describeSpeed } from "@/lib/payouts";
import type { Standing } from "@/lib/reliability";
import type { MilestoneKey } from "@/lib/milestones";
import { claimWindowEndsAt } from "@/lib/claims";
import { HOST_TERMS_VERSION, hasAcceptedHostTerms } from "@/lib/host-terms";
import { listingGaps } from "@/lib/listing-quality";
import { FALLBACK_ZONE, zoneAbbreviation } from "@/lib/timezone";
import { sessionDate, sessionTime } from "@/lib/when";
import { roomTypeFor } from "@/lib/taxonomy";

import { GroupLabel, ProfileHeader, ProfileRow, SettingToggle } from "./practitioner-extras";

/**
 * "2 spaces · 1 hidden", or nothing to say when there is nothing to say.
 *
 * The hidden count is the reason this line exists. A host whose only space is
 * hidden currently sees a dashboard that looks entirely normal, with no
 * explanation for why nothing is booking.
 */
function spacesSummary(spaces: HostSpace[]): string {
  const hidden = spaces.filter((space) => space.status === "delisted").length;
  const count = `${spaces.length} space${spaces.length === 1 ? "" : "s"}`;
  return hidden > 0 ? `${count} · ${hidden} hidden` : count;
}

/* ------------------------------------------------------------------ */
/*  Host dashboard                                                     */
/* ------------------------------------------------------------------ */

export function HostDashboard({
  spaces,
  bookings,
  requests,
  onAnswerRequest,
  onAddSpace,
  onEditHours,
  onEditSpace,
  onPreviewSpace,
  onOpenEarnings,
  onOpenProfile,
  onGoNotifications,
  undeliveredCount,
  onReviewBooking,
  onReportProblem,
  onMessageBooking,
  hostTermsVersion,
  hostTermsAcceptedAt,
}: {
  spaces: HostSpace[];
  bookings: HostBooking[];
  /** Waiting on the host. Empty on every listing that books instantly. */
  requests: BookingRequest[];
  /**
   * The Host Terms this host has accepted, and when — from their profile. Null
   * on an account that has never accepted (an existing host from before the
   * Host Terms), which the Legal card names rather than hides.
   */
  hostTermsVersion: number | null;
  hostTermsAcceptedAt: Date | null;
  onAnswerRequest: (
    bookingId: string,
    decision: "approve" | "decline",
    note?: string,
  ) => Promise<void>;
  onAddSpace: () => void;
  onEditHours: (spaceId: string) => void;
  onEditSpace: (spaceId: string) => void;
  /** Opens the listing as a practitioner sees it. Live listings only. */
  onPreviewSpace: (spaceId: string) => void;
  onOpenEarnings: () => void;
  onOpenProfile: () => void;
  onGoNotifications: () => void;
  /** Messages that never arrived. */
  undeliveredCount: number;
  /** Absent until the review window opens for a session. */
  onReviewBooking?: (bookingId: string) => void;
  /** Absent once the 48-hour window on that session has closed. */
  onReportProblem?: (bookingId: string) => void;
  /** Opens the thread for a booking. */
  onMessageBooking?: (bookingId: string) => void;
}) {
  /*
   * A host's bookings are for their own rooms, so the hour belongs on the
   * room's clock. It costs nothing while a host lives where their studio is,
   * and is the whole answer the day one of them does not.
   */
  const zoneOf = (spaceId: string) =>
    spaces.find((s) => s.id === spaceId)?.timeZone ?? FALLBACK_ZONE;

  const [activeId, setActiveId] = useState<string | null>(spaces[0]?.id ?? null);
  const active = spaces.find((s) => s.id === activeId) ?? spaces[0] ?? null;

  if (!active) {
    return (
      <HostEmptyState onAddSpace={onAddSpace} onOpenProfile={onOpenProfile} />
    );
  }

  const pending = active.status === "pending";
  const hidden = active.status === "delisted";
  const spaceBookings = bookings.filter((b) => b.spaceId === active.id);

  /**
   * Split by the clock, not by status.
   *
   * The list was headed "Upcoming" and showed everything — past sessions and
   * cancellations included — so a host could not tell what was still coming
   * without reading every date. A cancelled booking is neither: it is not
   * ahead of them and it is not something that happened.
   */
  const now = new Date();
  const upcoming = spaceBookings
    .filter((b) => b.status === "upcoming" && b.startsAt >= now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = spaceBookings
    .filter((b) => b.status !== "upcoming" || b.startsAt < now)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  /**
   * Earned, and only from sessions that happened.
   *
   * This was every booking on the listing summed together under the label
   * "this month" — including cancelled ones, and including next month's. A
   * host reading that number is reading it for tax, so it counts completed
   * sessions in the current calendar month and nothing else.
   */
  const monthCents = spaceBookings
    .filter(
      (b) =>
        b.status === "completed" &&
        b.startsAt.getMonth() === now.getMonth() &&
        b.startsAt.getFullYear() === now.getFullYear(),
    )
    .reduce((sum, b) => sum + b.netCents, 0);
  const hoursFilled = spaceBookings.filter((b) => b.status === "completed").length;

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-16 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        {/*
          No back button. This is the host's root screen and there is nothing
          behind it — the browse screen belongs to the other side of the
          marketplace, so the guard bounced straight back here and the button
          did nothing every time it was pressed.
        */}
        <div className="flex items-center justify-between mb-4 relative z-10">
          <LogoBadge size={30} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAddSpace}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full font-body font-medium text-[15px] press text-white"
              style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
            >
              <Plus size={13} /> Add space
            </button>
            <button
              type="button"
              onClick={onGoNotifications}
              aria-label="What we've sent you"
              className="w-9 h-9 rounded-full flex items-center justify-center press relative"
              style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
            >
              <Bell size={15} color="#fff" />
              {/*
                A dot only for a message that never arrived. A host who missed
                the alert about a booking is the whole reason this exists.
              */}
              {undeliveredCount > 0 && (
                <span
                  className="absolute rounded-full"
                  style={{
                    top: 1,
                    right: 1,
                    width: 8,
                    height: 8,
                    backgroundColor: "#F2695C",
                    border: "1.5px solid #16304E",
                  }}
                />
              )}
            </button>
            <button
              type="button"
              onClick={onOpenProfile}
              aria-label="Host profile"
              className="w-9 h-9 rounded-full flex items-center justify-center press"
              style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
            >
              <User size={15} color="#fff" />
            </button>
          </div>
        </div>

        {spaces.length > 1 && (
          <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar relative z-10">
            {spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                onClick={() => setActiveId(space.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-[14px] whitespace-nowrap press text-white"
                style={{
                  backgroundColor: space.id === active.id ? "#3B9BE8" : "rgba(255,255,255,0.1)",
                  border: `1px solid ${space.id === active.id ? "#3B9BE8" : "rgba(255,255,255,0.18)"}`,
                }}
              >
                {space.name}
                {space.status === "pending" && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: "#F2A79E" }}
                  />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 relative z-10">
          <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
            Host studio
          </p>
          <AccountBadge accountType="host" tone="dark" />
        </div>
        <div className="mt-1 relative z-10">
          <Headline pre={`${active.name} —`} accent={roomTypeFor(active.category)} size={23} light />
        </div>
        <p className="font-body font-normal text-[14px] text-white/65 mt-1 relative z-10">
          {pending
            ? "Under review — usually same day"
            : `${formatCents(active.hourlyRateCents)} an hour, yours in full`}
        </p>
        {/*
          The address, on the host's own screen. It is withheld from
          practitioners until they have booked, but this is the owner looking
          at their own listing, and a host with several rooms needs to see
          which one they are reading.
        */}
        {active.addressLine && (
          <p className="font-body font-normal text-[13.5px] text-white/45 mt-1 relative z-10">
            {active.addressLine}
          </p>
        )}
      </div>

      {pending ? (
        <div className="flex-1 overflow-y-auto px-6 pt-8 pb-8">
          <div className="flex flex-col items-center text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "#FEF2F0" }}
            >
              <ShieldAlert size={22} color="#F2695C" />
            </div>
            <p className="font-display italic font-semibold text-[19px] text-navy">
              Checking your documents
            </p>
          </div>

          {/*
            Which file, and where it got to. The screen used to say only that
            something was being checked, which is the same word for "nobody has
            opened it yet" and "we read it and it was unreadable".
          */}
          <div className="flex flex-col gap-2.5 mt-6">
            <DocumentStatus
              label="Proof you can sublease"
              fileName={active.subleaseDocName}
              review={active.subleaseReview}
              note={active.reviewNote}
            />
            <DocumentStatus
              label="Space insurance"
              fileName={active.insuranceDocName}
              review={active.insuranceReview}
              optional
            />
          </div>

          <button
            type="button"
            onClick={() => onEditSpace(active.id)}
            className="w-full mt-5 py-3 rounded-xl font-body font-medium text-[15px] press"
            style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
          >
            Edit this listing
          </button>
        </div>
      ) : (
        <>
          {/*
          Said on the dashboard, not only in the list.

          A host whose space is hidden used to come back to a screen that
          looked entirely normal — no bookings, and nothing anywhere to explain
          why. The switch that caused it was three taps inside Edit, so it was
          also the last place anybody would look.
        */}
        {hidden && (
          <div
            className="rounded-xl p-4 mb-3"
            style={{ backgroundColor: "#F1F3F6", border: "1px solid #DDE3EA" }}
          >
            <p className="font-body font-medium text-[14.5px] text-navy">This space is hidden</p>
            <p className="font-body font-normal text-[14px] leading-relaxed mt-1 text-ink-soft">
              Nobody can find or book it. Bookings already made are untouched — you can put it
              back from Your spaces.
            </p>
          </div>
        )}

        <div className="px-6 -mt-9 shrink-0">
            <button
              type="button"
              onClick={onOpenEarnings}
              className="w-full text-left rounded-[22px] p-5 grid grid-cols-2 gap-5 bg-white press"
              style={{
                boxShadow: "0 18px 40px -18px rgba(22,48,78,0.3)",
                border: "1px solid #E7EEF6",
              }}
            >
              <div>
                <p className="font-body text-[12px] uppercase tracking-wide text-ink-faint">
                  This month
                </p>
                <p className="font-display italic font-semibold text-[26px] mt-1 text-navy">
                  {formatCents(monthCents)}
                </p>
                <p className="font-body text-[13.5px] mt-0.5 flex items-center gap-1 text-sky-text">
                  View earnings <ChevronRight size={11} />
                </p>
              </div>
              <div>
                <p className="font-body text-[12px] uppercase tracking-wide text-ink-faint">
                  Hours booked
                </p>
                <p className="font-display italic font-semibold text-[26px] mt-1 text-navy">
                  {hoursFilled}
                </p>
                <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-faint">
                  {hoursFilled === 0 ? "Nothing booked yet" : "So far this month"}
                </p>
              </div>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pt-6 pb-8">
            <Unfinished space={active} onEdit={() => onEditSpace(active.id)} />

            {/*
              Above the calendar, and above the listing's own warnings. A
              request expires on a clock the host cannot see running, so it is
              the one thing on this screen that gets worse while it is ignored.
            */}
            <RequestQueue
              requests={requests.filter((r) => r.spaceId === active.id)}
              zoneOf={zoneOf}
              onAnswer={onAnswerRequest}
            />

            <div className="mb-3">
              <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-2.5 text-sky-text">
                Upcoming
              </p>
              {/*
                Their own row, not squeezed beside the heading. Three actions
                and a section title on one line left about forty pixels each,
                which on a phone is three targets too close to hit apart.
              */}
              <div className="flex items-center gap-2 flex-wrap">
                {/*
                  A host cannot otherwise see their own listing the way it is
                  actually presented — the photos they chose, in the order
                  they chose, at the size a practitioner sees them. They were
                  publishing a page they had never looked at.
                */}
                <button
                  type="button"
                  onClick={() => onPreviewSpace(active.id)}
                  className="px-3 py-1.5 rounded-full font-body text-[15px] font-medium press text-sky-text"
                  style={{ border: "1px solid #DCE7F2" }}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => onEditSpace(active.id)}
                  className="px-3 py-1.5 rounded-full font-body text-[15px] font-medium press text-sky-text"
                  style={{ border: "1px solid #DCE7F2" }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onEditHours(active.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full font-body text-[15px] font-medium press text-coral"
                  style={{ border: "1px solid #F5C4BC" }}
                >
                  <Plus size={13} /> Open more hours
                </button>
              </div>
            </div>

            {upcoming.length === 0 ? (
              <div
                className="rounded-2xl p-4"
                style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
              >
                <p className="font-body font-normal text-[14px] leading-relaxed text-ink-soft">
                  {past.length > 0 ? "Nothing booked ahead." : "No bookings yet."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {upcoming.map((booking, i) => (
                  <HostBookingRow
                    key={booking.id}
                    booking={booking}
                    timeZone={zoneOf(booking.spaceId)}
                    index={i}
                    onMessage={onMessageBooking ? () => onMessageBooking(booking.id) : undefined}
                  />
                ))}
              </div>
            )}

            {past.length > 0 && (
              <>
                <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-text mt-7 mb-3">
                  Past
                </p>
                <div className="flex flex-col gap-2.5">
                  {past.map((booking, i) => (
                    <HostBookingRow
                      key={booking.id}
                      booking={booking}
                      timeZone={zoneOf(booking.spaceId)}
                      index={i}
                      past
                      onReview={onReviewBooking ? () => onReviewBooking(booking.id) : undefined}
                      onReportProblem={
                        onReportProblem && withinClaimWindow(booking)
                          ? () => onReportProblem(booking.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </>
            )}

            <HostLegalCard version={hostTermsVersion} acceptedAt={hostTermsAcceptedAt} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The host's legal standing, on their own dashboard.
 *
 * One card that answers "what have I agreed to, and is it current" — the
 * version and date of the Host Terms this host accepted, a link to read them,
 * and a plain note when a newer version is in force. It does not itself
 * re-collect acceptance: that happens at the point of listing, where the
 * server gate is, so there is one place a host accepts and one place it is
 * enforced. This is the record of it, not a second door to it.
 */
function HostLegalCard({
  version,
  acceptedAt,
}: {
  version: number | null;
  acceptedAt: Date | null;
}) {
  const accepted = hasAcceptedHostTerms({ hostTermsVersion: version });
  // Accepted, but behind the version now in force — re-asked at the next listing.
  const outdated = version !== null && !accepted;
  const dateLabel = acceptedAt
    ? acceptedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="mt-7">
      <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-text mb-3">
        Legal
      </p>
      <div className="rounded-2xl p-4" style={{ border: "1px solid #E7EEF6" }}>
        <div className="flex items-start gap-3">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: "#F4F8FC" }}
          >
            <ScrollText size={16} color="#3B9BE8" />
          </span>
          <div className="min-w-0">
            <p className="font-body font-medium text-[15px] text-navy">Host Terms</p>
            {accepted && (
              <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
                Accepted · version {version}
                {dateLabel ? ` · ${dateLabel}` : ""}
              </p>
            )}
            {outdated && (
              <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
                You accepted version {version}. Version {HOST_TERMS_VERSION} is now in effect —
                you&apos;ll be asked to accept it the next time you list a space.
              </p>
            )}
            {version === null && (
              <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
                You haven&apos;t accepted the current Host Terms yet. You&apos;ll be asked the next
                time you list a space. Your existing listings are unaffected.
              </p>
            )}
            <a
              href="/host-terms"
              target="_blank"
              rel="noreferrer"
              className="font-body text-[13.5px] mt-1.5 inline-flex items-center gap-1 text-sky-text"
            >
              View Host Terms <ChevronRight size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function HostEmptyState({
  onAddSpace,
  onOpenProfile,
}: {
  onAddSpace: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-14 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <div className="flex items-center justify-between relative z-10">
          <LogoBadge size={30} />
          {/*
            The profile has to be reachable here too.
            This is the screen a host sees until their first listing is live —
            which is exactly when they want to add a payout account, a photo,
            or an emergency contact. The logo sat here alone, so the only way
            to their own settings was to first finish listing a room.
          */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              aria-label="Host profile"
              className="w-9 h-9 rounded-full flex items-center justify-center press"
              style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
            >
              <User size={15} color="#fff" />
            </button>
          </div>
        </div>
        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-4 relative z-10 text-sky-soft">
          Host studio
        </p>
        <div className="mt-1 relative z-10">
          <Headline pre="Turn empty hours" accent="into income." size={22} light />
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-9 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
          style={{ backgroundColor: "#EDF6FE" }}
        >
          <Building2 size={26} color="#3B9BE8" />
        </div>
        <p className="font-display italic font-semibold text-[19px] text-navy">
          No spaces listed yet
        </p>
        <p className="font-body font-normal text-[14px] leading-relaxed mt-2 max-w-[240px] text-ink-soft">
          Add your room&apos;s location, a rate, and a couple of photos — it takes about two
          minutes.
        </p>
        <button
          type="button"
          onClick={onAddSpace}
          className="mt-6 px-7 py-3.5 rounded-full font-body font-medium text-[15px] text-white press sheen-wrap"
          style={{ backgroundColor: "#2578C2", boxShadow: "0 12px 28px -8px rgba(37,120,194,0.45)" }}
        >
          List your first space
          <span className="sheen" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Edit availability                                                  */
/* ------------------------------------------------------------------ */

export function EditAvailability({
  space,
  onBack,
  onSave,
}: {
  space: HostSpace;
  onBack: () => void;
  /** Rejects when the hours do not save, so this screen does not claim they did. */
  onSave: (blocks: AvailabilityBlock[]) => Promise<unknown>;
}) {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>(space.availability);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-4 relative z-10 text-sky-soft">
          {space.name}
        </p>
        <div className="mt-1 relative z-10">
          <Headline pre="Open more" accent="hours." size={22} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <p className="font-body font-normal text-[13.5px] mb-3 text-ink-faint">
          Turn on the days you&apos;re open. This repeats every week until you change it again.
          Times are {zoneAbbreviation(new Date(), space.timeZone)}, taken from the listing&apos;s
          address — a practitioner elsewhere sees them converted to theirs.
        </p>
        <WeekSchedule blocks={blocks} onChange={setBlocks} />
      </div>

      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        {/*
          It said "Saved" and left, without waiting to find out. A host who
          lost their connection mid-tap watched the word appear, went back, and
          believed their room was open on hours it had never been given.
        */}
        {saveError && (
          <p
            className="font-body font-normal text-[14px] leading-relaxed mb-3 rounded-xl p-3"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
            role="alert"
          >
            {saveError}
          </p>
        )}

        <PrimaryButton
          disabled={saving}
          onClick={() => {
            setSaveError(null);
            setSaving(true);
            void onSave(blocks)
              .then(() => {
                setSaved(true);
                setTimeout(onBack, 700);
              })
              .catch((cause) =>
                setSaveError(errorMessage(cause, "Those hours did not save. Try again.")),
              )
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save hours"}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Earnings                                                           */
/* ------------------------------------------------------------------ */

/**
 * The federal 1099-K threshold: over $20,000 *and* more than 200 transactions
 * in a calendar year. Both must be true, which is why a host well past the
 * dollar figure on a handful of long bookings still gets no form.
 */
const FORM_1099K_DOLLARS = 20_000;
const FORM_1099K_TRANSACTIONS = 200;

export function Earnings({
  spaces,
  bookings,
  onBack,
}: {
  spaces: HostSpace[];
  bookings: HostBooking[];
  onBack: () => void;
}) {
  const now = new Date();
  const thisMonth = bookings.filter(
    (b) => b.startsAt.getFullYear() === now.getFullYear() && b.startsAt.getMonth() === now.getMonth(),
  );
  const thisYear = bookings.filter((b) => b.startsAt.getFullYear() === now.getFullYear());

  const monthCents = thisMonth.reduce((sum, b) => sum + b.netCents, 0);
  // Actual bookings in the current year. The prototype multiplied the month's
  // total by three and called it year-to-date, which invented money on the
  // screen a host uses for their tax records.
  const yearCents = thisYear.reduce((sum, b) => sum + b.netCents, 0);

  const meets1099K =
    yearCents >= FORM_1099K_DOLLARS * 100 && thisYear.length >= FORM_1099K_TRANSACTIONS;

  const nameFor = (spaceId: string) => spaces.find((s) => s.id === spaceId)?.name ?? "Space";
  /*
   * A host's bookings are for their own rooms, so the hour is written on the
   * room's clock — which matters the moment a host lists a space in a city they
   * do not live in, and costs nothing while they do.
   */
  const zoneFor = (spaceId: string) =>
    spaces.find((s) => s.id === spaceId)?.timeZone ?? FALLBACK_ZONE;

  const exportCsv = () => {
    const rows: string[][] = [["Date", "Space", "Practitioner", "Type", "Net payout"]];
    for (const booking of thisYear) {
      rows.push([
        booking.startsAt.toISOString().slice(0, 10),
        nameFor(booking.spaceId),
        booking.practitionerName,
        booking.practitionerCraft,
        (booking.netCents / 100).toFixed(2),
      ]);
    }
    rows.push([]);
    rows.push([`Year-to-date total`, "", "", "", (yearCents / 100).toFixed(2)]);

    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `minimum-stress-earnings-${now.getFullYear()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
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
          <Headline pre="Your" accent="earnings." size={24} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="This month" value={formatCents(monthCents)} />
          <StatCard label="Year to date" value={formatCents(yearCents)} />
        </div>

        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-7 mb-3 text-sky-text">
          Transaction history
        </p>
        {thisYear.length === 0 ? (
          <p className="font-body font-normal text-[14px] text-ink-faint">Nothing paid out yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {thisYear.map((booking) => (
              <div
                key={booking.id}
                className="flex items-center justify-between p-3 rounded-xl gap-3"
                style={{ backgroundColor: "#F9FAFB" }}
              >
                <div className="min-w-0">
                  <p className="font-body font-medium text-[14.5px] text-navy truncate">
                    {booking.practitionerName}
                  </p>
                  <p className="font-body font-normal text-[13.5px] text-ink-faint truncate">
                    {nameFor(booking.spaceId)} ·{" "}
                    {sessionDate(booking.startsAt, zoneFor(booking.spaceId))}
                  </p>
                </div>
                <p className="font-body font-semibold text-[14.5px] text-navy shrink-0">
                  +{formatCents(booking.netCents)}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-7 mb-3 text-sky-text">
          Tax documents
        </p>
        <div
          className="rounded-2xl p-4"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <p className="font-body font-normal text-[14px] leading-relaxed text-ink-muted">
            {meets1099K
              ? `You've passed $${FORM_1099K_DOLLARS.toLocaleString()} across ${FORM_1099K_TRANSACTIONS}+ bookings this year, so a 1099-K will be issued automatically at year-end.`
              : `A 1099-K is issued only above $${FORM_1099K_DOLLARS.toLocaleString()} and ${FORM_1099K_TRANSACTIONS} bookings in a year — both, not either. You're at ${formatCents(yearCents)} across ${thisYear.length}, so no form is due. Your state may set a lower threshold.`}
          </p>
          <button
            type="button"
            onClick={exportCsv}
            disabled={thisYear.length === 0}
            className="w-full mt-3 py-3 rounded-xl font-body font-medium text-[15px] press"
            style={{
              backgroundColor: thisYear.length === 0 ? "#E9F0F7" : "#3B9BE8",
              color: thisYear.length === 0 ? "#8CA3BD" : "#fff",
            }}
          >
            Download year-to-date CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
    >
      <p className="font-body text-[12px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="font-display italic font-semibold text-[22px] mt-1 text-navy">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Host profile                                                       */
/* ------------------------------------------------------------------ */

export function HostProfile({
  profile,
  spaces,
  standing,
  onBack,
  onUpdate,
  sessions,
  milestones,
  milestoneTotal,
  onDeleteAccount,
  onPickAvatar,
  onGoLegal,
  onGoSpaces,
  onConnectPayouts,
  onOpenPayoutDashboard,
  onSignOut,
}: {
  profile: Profile;
  spaces: HostSpace[];
  standing: Standing;
  onBack: () => void;
  onUpdate: (patch: Partial<Profile>) => Promise<unknown>;
  /** Completed, paid sessions. Drives the badges and nothing else. */
  sessions: number;
  /** The moments reached so far, counted in app.tsx from bookings and payouts. */
  milestones: MilestoneKey[];
  /** What the empty hours earned, or null before there is anything to say. */
  milestoneTotal: string | null;
  /** Irreversible, and the screen says so before it runs. */
  onDeleteAccount: () => Promise<void>;
  /** Uploads the picture and resolves once it is stored, not once it is shown. */
  onPickAvatar: (file: File) => Promise<unknown>;
  onGoLegal: () => void;
  /** The list of every space, and where hiding one now lives. */
  onGoSpaces: () => void;
  /** Rejects when Stripe cannot be reached, so the screen can say so. */
  onConnectPayouts: () => Promise<unknown>;
  onOpenPayoutDashboard: () => Promise<unknown>;
  onSignOut: () => void;
}) {
  const activeCount = spaces.filter((s) => s.status === "active").length;
  const pendingCount = spaces.filter((s) => s.status === "pending").length;

  /*
   * Both payout actions leave for Stripe, and both used to fail in silence:
   * the caller discarded the promise, so a host tapping "Payout method" got a
   * blank tab and no reason for it. A trip that does not happen has to say so
   * on the screen it was started from.
   */
  const [payoutError, setPayoutError] = useState<string | null>(null);
  /*
   * One trip at a time. Building the link is a round trip to Stripe, and until
   * the browser starts leaving there is nothing on screen to show for the tap
   * — so it gets tapped again, and again, and each one was another request.
   * That is how a host reached a rate limit meant to stop scripts, and then
   * could not open their own bank details at all.
   */
  const [leaving, setLeaving] = useState(false);
  const goToStripe = (action: () => Promise<unknown>) => () => {
    if (leaving) return;
    setPayoutError(null);
    setLeaving(true);
    void action()
      .catch((cause) => {
        setPayoutError(errorMessage(cause, "Could not reach Stripe. Try again in a moment."));
      })
      .finally(() => setLeaving(false));
  };

  // Priced against a real listing where there is one, so the instant-payout
  // figure is the host's own money rather than a generic example.
  const exampleRateCents = spaces[0]?.hourlyRateCents ?? 0;
  const selectedSpeed = describeSpeed(profile.payoutSchedule, exampleRateCents);

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <ProfileHeader
        onBack={onBack}
        avatarUrl={profile.avatarUrl}
        onPickAvatar={onPickAvatar}
        accountType={profile.accountType}
        name={profile.displayName ?? ""}
        onName={(displayName) => onUpdate({ displayName })}
        sub={`${activeCount} active space${activeCount === 1 ? "" : "s"}${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}`}
      />

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {/* Always visible, so it is never a surprise on the day it costs something. */}
        <div className="mb-6">
          <StandingNotice party="host" standing={standing} />
        </div>

        <GroupLabel>Notifications</GroupLabel>
        <div className="flex flex-col gap-2.5">
          <SettingToggle
            label="New booking alerts"
            sub="The moment a practitioner books"
            on={profile.notifyBookings}
            onToggle={() => onUpdate({ notifyBookings: !profile.notifyBookings })}
          />
          {/*
            "Payout alerts — when money lands in your account" once stood here
            and switched nothing off: SILENCEABLE maps it to `host_payout_sent`,
            a kind nobody sends. There is no arriving-money email to silence.
            The only payout mail a host gets is payout_failed — money stuck at
            their bank — which is never optional, so there is no toggle for it.
            The switch above is the real one, and gates host_new_booking.
          */}
        </div>

        <div className="mt-6">
          <GroupLabel>Payouts</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          {profile.payoutSetup === "ready" ? (
            /*
              Tappable, because onboarding was otherwise a one-way door. A
              bank account that changes, or a detail Stripe starts asking for
              later, is fixed on their side and the app had no way through.
            */
            <ProfileRow
              icon={ShieldCheck}
              label="Payout method"
              value="Stripe · connected"
              onClick={goToStripe(onOpenPayoutDashboard)}
            />
          ) : profile.payoutSetup === "in_review" ? (
            /*
              The hours between submitting the form and Stripe enabling the
              account. "We'll review your application" is the last thing the
              host was told, and this screen answered it with "Payouts not set
              up" and a button to start again — which reads as though the
              submission had been lost, and invites them to redo it.

              Still tappable: the same link reopens what they filled in, which
              is where Stripe asks for anything more it wants.
            */
            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: "#F4F8FC", border: "1px solid #D6E6F5" }}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} color="#2578C2" />
                <span className="font-body font-medium text-[14.5px] text-navy">
                  Stripe is checking your details
                </span>
              </div>
              <p className="font-body font-normal text-[14px] leading-relaxed mt-1.5 text-ink-soft">
                Usually minutes, sometimes a day or two. We&apos;ll write the moment payouts are
                live — nothing needs doing until then, and your space can keep taking bookings.
              </p>
              <button
                type="button"
                onClick={goToStripe(onOpenPayoutDashboard)}
                className="w-full mt-3 py-2.5 rounded-lg font-body font-medium text-[14.5px] press bg-white text-sky-text"
                style={{ border: "1px solid #D6E6F5" }}
              >
                View what you submitted
              </button>
            </div>
          ) : (
            /*
              Not a settings row. Without this a host can take bookings and
              never be paid, so it states the consequence rather than sitting
              quietly greyed out saying "Not set up".
            */
            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
            >
              <div className="flex items-center gap-2">
                <ShieldAlert size={15} color="#8B6C37" />
                <span className="font-body font-medium text-[14.5px] text-navy">
                  Payouts not set up
                </span>
              </div>
              <p className="font-body font-normal text-[14px] leading-relaxed mt-1.5 text-[#7A5B33]">
                Your space can still take bookings, but nothing can reach your bank until this is
                done. Stripe collects your bank and identity details directly — we never see them.
              </p>
              <button
                type="button"
                onClick={goToStripe(onConnectPayouts)}
                className="w-full mt-3 py-3 rounded-xl font-body font-medium text-[15px] text-white press"
                style={{ backgroundColor: "#2578C2" }}
              >
                Set up payouts
              </button>
            </div>
          )}

          {payoutError && (
            <div
              className="rounded-xl p-3"
              style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC" }}
              role="alert"
            >
              <p
                className="font-body font-normal text-[14px] leading-relaxed"
                style={{ color: "#7A4A42" }}
              >
                {payoutError}
              </p>

              {/*
                A way out, on the screen the failure appeared on. Some of these
                are only fixed by onboarding again — an account id written
                before a key rotation cannot be opened, and the row above still
                says "connected" because our own column still says so. Without
                this the host reads a refusal and has nothing to press.
              */}
              {profile.payoutSetup !== "not_started" && (
                <button
                  type="button"
                  onClick={goToStripe(onConnectPayouts)}
                  className="w-full mt-2.5 py-2.5 rounded-lg font-body font-medium text-[14.5px] text-white press"
                  style={{ backgroundColor: "#2578C2" }}
                >
                  Set up payouts again
                </button>
              )}
            </div>
          )}

          {/* The Standard-vs-Instant choice the brief calls for. */}
          <div className="rounded-xl bg-white p-3.5" style={{ border: "1px solid #E7EEF6" }}>
            <div className="flex items-center gap-3 mb-3">
              <Wallet size={15} color="#3B9BE8" />
              <span className="font-body font-medium text-[14.5px] text-navy">Payout schedule</span>
            </div>
            <div className="flex gap-2">
              {(
                [
                  { key: "standard", label: "Standard", sub: `${PAYOUT_DELAY_DAYS} business days` },
                  { key: "instant", label: "Instant", sub: "Minutes, for a fee" },
                ] as const
              ).map((option) => {
                const selected = profile.payoutSchedule === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => onUpdate({ payoutSchedule: option.key })}
                    aria-pressed={selected}
                    className="flex-1 rounded-xl p-2.5 text-left press"
                    style={{
                      backgroundColor: selected ? "#EDF6FE" : "#fff",
                      border: `1px solid ${selected ? "#3B9BE8" : "#DCE7F2"}`,
                    }}
                  >
                    <span className="block font-body font-medium text-[15px] text-navy">
                      {option.label}
                    </span>
                    <span className="block font-body font-normal text-[12px] mt-0.5 text-ink-faint">
                      {option.sub}
                    </span>
                  </button>
                );
              })}
            </div>
            {/*
              The exact figure, on their own rate, rather than "a small fee".
              This is the one place a host's take can differ from what they
              set — our service fee never touches it, but Stripe's charge for
              moving money early does — so it is stated as a number they can
              check against their bank.
            */}
            <p className="font-body font-normal text-[13.5px] leading-relaxed mt-2.5 text-ink-faint">
              {selectedSpeed.arrival}
              {selectedSpeed.costLine ? ` — ${selectedSpeed.costLine}` : "."}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <GroupLabel>Account</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          {/*
            Above the legal rows because it is the one somebody comes here for.
            Hiding a space used to live three taps inside Edit, which is the
            wrong place: it is not an edit, it is the switch that decides
            whether the space exists for anybody else.
          */}
          <ProfileRow
            icon={Building2}
            label="Your spaces"
            value={spacesSummary(spaces)}
            onClick={onGoSpaces}
          />
          <ProfileRow icon={ScrollText} label="Terms & privacy" onClick={onGoLegal} />
          <ProfileRow icon={LogOut} label="Log out" onClick={onSignOut} danger />
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          {/*
            Above the badges, because these are the ones somebody can actually
            reach this year. badge-card holds itself back until twenty-five
            sessions and starts counting at a hundred.
          */}
          <MilestoneCard party="host" earned={milestones} total={milestoneTotal} />
          <BadgeCard party="host" sessions={sessions} />
        </div>

        {/*
          Asked of both sides. Somebody alone in a stranger's building and
          somebody letting a stranger into theirs are in the same position.
        */}
        <div className="mt-6">
          <EmergencyContactCard
            contact={profile.emergencyContact}
            onSave={(emergencyContact) => onUpdate({ emergencyContact })}
          />
        </div>

        {/* Last, and on its own. Nothing here is undoable except this. */}
        <div className="mt-8">
          <DeleteAccount onDelete={onDeleteAccount} />
        </div>
      </div>
    </div>
  );
}

/**
 * One booking, as the host sees it.
 *
 * Net earnings only. A host never sees the service fee or a percentage — the
 * platform's cut is not deducted from this number, so showing it here would
 * only invite the wrong question.
 */
/**
 * What this listing is still missing, to the only person who can fix it.
 *
 * The listing screen hides every section it has nothing to put in, so a thin
 * listing does not look broken to anybody — it looks short. The host sees a
 * page that seems finished, the practitioner sees a photo and a calendar with
 * nothing in between, and the booking that does not happen leaves no trace.
 *
 * Said as what a practitioner is looking for rather than as a checklist, and
 * gone entirely once the listing is complete. A permanent scold on somebody's
 * own screen gets ignored by the second week.
 */
function Unfinished({ space, onEdit }: { space: HostSpace; onEdit: () => void }) {
  const gaps = listingGaps({
    description: space.description,
    amenities: space.amenities,
    access: space.access,
    parkingAnswered: space.parking.options.length > 0,
    mediaCount: space.media.length,
  });

  if (gaps.length === 0) return null;

  return (
    <div
      className="rounded-2xl p-4 mb-5"
      style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
    >
      <p className="font-body font-medium text-[14.5px]" style={{ color: "#8B6C37" }}>
        Practitioners look for {gaps.length === 1 ? "one more thing" : `${gaps.length} more things`}
      </p>

      <div className="flex flex-col gap-2.5 mt-3">
        {gaps.map((gap) => (
          <div key={gap.label}>
            <p className="font-body font-medium text-[13.5px] text-navy">{gap.label}</p>
            <p className="font-body font-normal text-[13px] mt-0.5 leading-relaxed text-ink-soft">
              {gap.because}
            </p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="w-full mt-3.5 py-2.5 rounded-xl font-body font-medium text-[14.5px] press"
        style={{ backgroundColor: "#fff", border: "1px solid #F5DFC4", color: "#8B6C37" }}
      >
        Add them
      </button>
    </div>
  );
}

/**
 * Whether this session can still be reported.
 *
 * The same window the server applies, so the link is never offered for a claim
 * the route would refuse — and it is short on purpose: a room used by other
 * people since cannot honestly be pinned on one of them.
 */
function withinClaimWindow(booking: HostBooking): boolean {
  if (booking.status !== "completed") return false;
  return claimWindowEndsAt(booking.startsAt) > new Date();
}

function HostBookingRow({
  booking,
  timeZone,
  index,
  past = false,
  onReview,
  onReportProblem,
  onMessage,
}: {
  booking: HostBooking;
  /** The room's zone — the clock this session's hour is written on. */
  timeZone: string;
  index: number;
  past?: boolean;
  onReview?: () => void;
  onReportProblem?: () => void;
  onMessage?: () => void;
}) {
  const cancelled = booking.status.startsWith("cancelled");

  return (
    <div
      className="p-3.5 rounded-2xl card-in bg-white"
      style={{
        border: "1px solid #E7EEF6",
        animationDelay: `${index * 80}ms`,
        boxShadow: "0 4px 14px -8px rgba(22,48,78,0.1)",
        // Cancelled sessions stay in the list because they are part of the
        // record, but they should not read as earnings.
        opacity: cancelled ? 0.6 : 1,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-display italic font-semibold text-[15.5px] shrink-0"
            style={{ backgroundColor: "#EDF6FE", color: "#16304E" }}
          >
            {booking.practitionerName[0]}
          </div>
          <div className="min-w-0">
            <p className="font-body font-medium text-[14.5px] text-navy truncate">
              {booking.practitionerName}
            </p>
            <p className="font-body font-normal text-[13.5px] text-ink-soft truncate">
              {booking.practitionerCraft} ·{" "}
              {sessionDate(booking.startsAt, timeZone)}{" "}
              {sessionTime(booking.startsAt, timeZone)}
            </p>
          </div>
        </div>

        <p
          className="font-body font-semibold text-[15.5px] shrink-0"
          style={{ color: cancelled ? "#8CA3BD" : "#16304E" }}
        >
          {cancelled ? "—" : `+${formatCents(booking.netCents)}`}
        </p>
      </div>

      {past && cancelled && (
        <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
          Cancelled by {booking.status === "cancelled_by_host" ? "you" : "the practitioner"}.
        </p>
      )}

      {/*
        Only ahead of a session. Afterwards the thread is history, and the
        thing worth offering is a review.
      */}
      {!past && !cancelled && onMessage && (
        <button
          type="button"
          onClick={onMessage}
          className="w-full mt-3 py-2.5 rounded-xl font-body font-medium text-[15px] press flex items-center justify-center gap-1.5"
          style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
        >
          <MessageCircle size={13} /> Message
        </button>
      )}

      {past && !cancelled && onReview && (
        <button
          type="button"
          onClick={onReview}
          className="w-full mt-3 py-2.5 rounded-xl font-body font-medium text-[15px] press"
          style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
        >
          Leave a review
        </button>
      )}

      {/*
        Quieter than the review, and underneath it. Most sessions end fine; a
        report offered with equal weight invites the thought rather than
        answering it.
      */}
      {past && !cancelled && onReportProblem && (
        <button
          type="button"
          onClick={onReportProblem}
          className="w-full mt-2 py-2 font-body text-[13.5px] press"
          style={{ color: "#8CA3BD" }}
        >
          Something was wrong with the room afterwards
        </button>
      )}
    </div>
  );
}
