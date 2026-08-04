"use client";

import { useState } from "react";
import {
  ArrowLeft,
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

import { Ambient, Headline, LogoBadge } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import { WeekSchedule } from "@/components/week-schedule";
import type { AvailabilityBlock } from "@/lib/availability";
import type { HostBooking, HostSpace, Profile } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { PAYOUT_DELAY_DAYS, describeSpeed } from "@/lib/payouts";
import { roomTypeFor } from "@/lib/taxonomy";

import { GroupLabel, ProfileHeader, ProfileRow, SettingToggle } from "./practitioner-extras";

/* ------------------------------------------------------------------ */
/*  Host dashboard                                                     */
/* ------------------------------------------------------------------ */

export function HostDashboard({
  spaces,
  bookings,
  onBack,
  onAddSpace,
  onApprove,
  onEditHours,
  onOpenEarnings,
  onOpenProfile,
  onSimulateBooking,
}: {
  spaces: HostSpace[];
  bookings: HostBooking[];
  onBack: () => void;
  onAddSpace: () => void;
  onApprove: (spaceId: string) => void;
  onEditHours: (spaceId: string) => void;
  onOpenEarnings: () => void;
  onOpenProfile: () => void;
  onSimulateBooking: (spaceId: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(spaces[0]?.id ?? null);
  const active = spaces.find((s) => s.id === activeId) ?? spaces[0] ?? null;

  if (!active) {
    return <HostEmptyState onBack={onBack} onAddSpace={onAddSpace} />;
  }

  const pending = active.status === "pending";
  const spaceBookings = bookings.filter((b) => b.spaceId === active.id);
  const monthCents = spaceBookings.reduce((sum, b) => sum + b.netCents, 0);
  const hoursFilled = spaceBookings.length;

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-16 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <div className="flex items-center justify-between mb-4 relative z-10">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center press"
            style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
          >
            <ArrowLeft size={16} color="#fff" />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAddSpace}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full font-body font-medium text-[11.5px] press text-white"
              style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
            >
              <Plus size={13} /> Add space
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-[11.5px] whitespace-nowrap press text-white"
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

        <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] relative z-10 text-sky-soft">
          Host studio
        </p>
        <div className="mt-1 relative z-10">
          <Headline pre={`${active.name} —`} accent={roomTypeFor(active.category)} size={23} light />
        </div>
        <p className="font-body font-light text-[11.5px] text-white/65 mt-1 relative z-10">
          {pending
            ? "Under review — usually same day"
            : `${formatCents(active.hourlyRateCents)} an hour, yours in full`}
        </p>
      </div>

      {pending ? (
        <div className="flex-1 flex flex-col items-center justify-center px-9 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: "#FEF2F0" }}
          >
            <ShieldAlert size={22} color="#F2695C" />
          </div>
          <p className="font-display italic font-semibold text-[19px] text-navy">
            Checking your documents
          </p>
          <p className="font-body font-light text-[12.5px] leading-relaxed mt-2 text-ink-soft">
            We&apos;re confirming your sublease proof and any insurance you added. Once it clears,
            this space goes live and starts taking bookings.
          </p>

          <button
            type="button"
            onClick={() => onApprove(active.id)}
            className="mt-8 px-4 py-2.5 rounded-xl font-body text-[11px] press text-ink-faint"
            style={{ border: "1px dashed #DCE7F2" }}
          >
            Prototype only — simulate approval →
          </button>
        </div>
      ) : (
        <>
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
                <p className="font-body text-[10px] uppercase tracking-wide text-ink-faint">
                  This month
                </p>
                <p className="font-display italic font-semibold text-[26px] mt-1 text-navy">
                  {formatCents(monthCents)}
                </p>
                <p className="font-body text-[10.5px] mt-0.5 flex items-center gap-1 text-sky">
                  View earnings <ChevronRight size={11} />
                </p>
              </div>
              <div>
                <p className="font-body text-[10px] uppercase tracking-wide text-ink-faint">
                  Hours booked
                </p>
                <p className="font-display italic font-semibold text-[26px] mt-1 text-navy">
                  {hoursFilled}
                </p>
                <p className="font-body font-light text-[10.5px] mt-0.5 text-ink-faint">
                  {hoursFilled === 0 ? "Nothing booked yet" : "So far this month"}
                </p>
              </div>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pt-6 pb-8">
            <div className="flex items-center justify-between mb-3">
              <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] text-sky">
                Upcoming
              </p>
              <button
                type="button"
                onClick={() => onEditHours(active.id)}
                className="flex items-center gap-1 font-body text-[12px] font-medium press text-coral"
              >
                <Plus size={13} /> Open more hours
              </button>
            </div>

            {spaceBookings.length === 0 ? (
              <div
                className="rounded-2xl p-4"
                style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
              >
                <p className="font-body font-light text-[11.5px] leading-relaxed text-ink-soft">
                  No bookings yet. That&apos;s normal for a new listing — opening more hours is the
                  single thing that helps most, since practitioners search by time before anything
                  else.
                </p>
                <button
                  type="button"
                  onClick={() => onSimulateBooking(active.id)}
                  className="w-full mt-3 py-2.5 rounded-xl font-body text-[10.5px] press text-ink-faint"
                  style={{ border: "1px dashed #DCE7F2" }}
                >
                  Prototype only — simulate a practitioner booking →
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {spaceBookings.map((booking, i) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between p-3.5 rounded-2xl card-in bg-white"
                    style={{
                      border: "1px solid #E7EEF6",
                      animationDelay: `${i * 80}ms`,
                      boxShadow: "0 4px 14px -8px rgba(22,48,78,0.1)",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-display italic font-semibold text-[14px] shrink-0"
                        style={{ backgroundColor: "#EDF6FE", color: "#16304E" }}
                      >
                        {booking.practitionerName[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="font-body font-medium text-[13px] text-navy truncate">
                          {booking.practitionerName}
                        </p>
                        <p className="font-body font-light text-[11px] text-ink-soft truncate">
                          {booking.practitionerCraft} ·{" "}
                          {booking.startsAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          {booking.startsAt.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                    {/*
                      Net earnings only. A host never sees the service fee or a
                      percentage — the platform's cut is not deducted from this
                      number, so showing it here would only invite the wrong
                      question.
                    */}
                    <p className="font-body font-semibold text-[14px] text-navy shrink-0">
                      +{formatCents(booking.netCents)}
                    </p>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onSimulateBooking(active.id)}
                  className="w-full mt-1 py-2.5 rounded-xl font-body text-[10.5px] press text-ink-faint"
                  style={{ border: "1px dashed #DCE7F2" }}
                >
                  Prototype only — simulate another booking →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HostEmptyState({
  onBack,
  onAddSpace,
}: {
  onBack: () => void;
  onAddSpace: () => void;
}) {
  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-14 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
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
            <ArrowLeft size={16} color="#fff" />
          </button>
          <LogoBadge size={34} />
        </div>
        <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] mt-4 relative z-10 text-sky-soft">
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
        <p className="font-body font-light text-[12.5px] leading-relaxed mt-2 max-w-[240px] text-ink-soft">
          Add your room&apos;s location, a rate, and a couple of photos — it takes about two
          minutes.
        </p>
        <button
          type="button"
          onClick={onAddSpace}
          className="mt-6 px-7 py-3.5 rounded-full font-body font-medium text-[13.5px] text-white press sheen-wrap"
          style={{ backgroundColor: "#3B9BE8", boxShadow: "0 12px 28px -8px rgba(59,155,232,0.5)" }}
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
  onSave: (blocks: AvailabilityBlock[]) => void;
}) {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>(space.availability);
  const [saved, setSaved] = useState(false);

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
        <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] mt-4 relative z-10 text-sky-soft">
          {space.name}
        </p>
        <div className="mt-1 relative z-10">
          <Headline pre="Open more" accent="hours." size={22} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <p className="font-body font-light text-[11px] mb-3 text-ink-faint">
          Turn on the days you&apos;re open. This repeats every week until you change it again.
        </p>
        <WeekSchedule blocks={blocks} onChange={setBlocks} />
      </div>

      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        <PrimaryButton
          onClick={() => {
            onSave(blocks);
            setSaved(true);
            setTimeout(onBack, 700);
          }}
        >
          {saved ? "Saved" : "Save hours"}
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

        <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] mt-7 mb-3 text-sky">
          Transaction history
        </p>
        {thisYear.length === 0 ? (
          <p className="font-body font-light text-[12.5px] text-ink-faint">Nothing paid out yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {thisYear.map((booking) => (
              <div
                key={booking.id}
                className="flex items-center justify-between p-3 rounded-xl gap-3"
                style={{ backgroundColor: "#F9FAFB" }}
              >
                <div className="min-w-0">
                  <p className="font-body font-medium text-[13px] text-navy truncate">
                    {booking.practitionerName}
                  </p>
                  <p className="font-body font-light text-[11px] text-ink-faint truncate">
                    {nameFor(booking.spaceId)} ·{" "}
                    {booking.startsAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <p className="font-body font-semibold text-[13px] text-navy shrink-0">
                  +{formatCents(booking.netCents)}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] mt-7 mb-3 text-sky">
          Tax documents
        </p>
        <div
          className="rounded-2xl p-4"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <p className="font-body font-light text-[11.5px] leading-relaxed text-ink-muted">
            {meets1099K
              ? `You've passed $${FORM_1099K_DOLLARS.toLocaleString()} across ${FORM_1099K_TRANSACTIONS}+ bookings this year, so a 1099-K will be issued automatically at year-end.`
              : `A 1099-K is issued only above $${FORM_1099K_DOLLARS.toLocaleString()} and ${FORM_1099K_TRANSACTIONS} bookings in a year — both, not either. You're at ${formatCents(yearCents)} across ${thisYear.length}, so no form is due. Your state may set a lower threshold.`}
          </p>
          <button
            type="button"
            onClick={exportCsv}
            disabled={thisYear.length === 0}
            className="w-full mt-3 py-3 rounded-xl font-body font-medium text-[12.5px] press"
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
      <p className="font-body text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
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
  onBack,
  onUpdate,
  onGoLegal,
  onConnectPayouts,
  onSignOut,
}: {
  profile: Profile;
  spaces: HostSpace[];
  onBack: () => void;
  onUpdate: (patch: Partial<Profile>) => void;
  onGoLegal: () => void;
  onConnectPayouts: () => void;
  onSignOut: () => void;
}) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const activeCount = spaces.filter((s) => s.status === "active").length;
  const pendingCount = spaces.filter((s) => s.status === "pending").length;

  // Priced against a real listing where there is one, so the instant-payout
  // figure is the host's own money rather than a generic example.
  const exampleRateCents = spaces[0]?.hourlyRateCents ?? 0;
  const selectedSpeed = describeSpeed(profile.payoutSchedule, exampleRateCents);

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <ProfileHeader
        onBack={onBack}
        avatarUrl={avatarUrl}
        onPickAvatar={(file) => {
          const url = URL.createObjectURL(file);
          setAvatarUrl(url);
          onUpdate({ avatarUrl: url });
        }}
        name={profile.displayName ?? ""}
        onName={(displayName) => onUpdate({ displayName })}
        sub={`${activeCount} active space${activeCount === 1 ? "" : "s"}${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}`}
      />

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <GroupLabel>Notifications</GroupLabel>
        <div className="flex flex-col gap-2.5">
          <SettingToggle
            label="New booking alerts"
            sub="The moment a practitioner books"
            on={profile.notifyBookings}
            onToggle={() => onUpdate({ notifyBookings: !profile.notifyBookings })}
          />
          <SettingToggle
            label="Payout alerts"
            sub="When money lands in your account"
            on={profile.notifyPayouts}
            onToggle={() => onUpdate({ notifyPayouts: !profile.notifyPayouts })}
          />
        </div>

        <div className="mt-6">
          <GroupLabel>Payouts</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          {profile.stripeConnected ? (
            <ProfileRow icon={ShieldCheck} label="Payout method" value="Stripe · connected" />
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
                <ShieldAlert size={15} color="#B08D4F" />
                <span className="font-body font-medium text-[13px] text-navy">
                  Payouts not set up
                </span>
              </div>
              <p className="font-body font-light text-[11.5px] leading-relaxed mt-1.5 text-[#7A5B33]">
                Your space can still take bookings, but nothing can reach your bank until this is
                done. Stripe collects your bank and identity details directly — we never see them.
              </p>
              <button
                type="button"
                onClick={onConnectPayouts}
                className="w-full mt-3 py-3 rounded-xl font-body font-medium text-[12.5px] text-white press"
                style={{ backgroundColor: "#3B9BE8" }}
              >
                Set up payouts
              </button>
              <p className="font-body font-light text-[10px] mt-2 text-center text-ink-faint">
                Prototype only — the real button opens Stripe&apos;s hosted onboarding.
              </p>
            </div>
          )}

          {/* The Standard-vs-Instant choice the brief calls for. */}
          <div className="rounded-xl bg-white p-3.5" style={{ border: "1px solid #E7EEF6" }}>
            <div className="flex items-center gap-3 mb-3">
              <Wallet size={15} color="#3B9BE8" />
              <span className="font-body font-medium text-[13px] text-navy">Payout schedule</span>
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
                    <span className="block font-body font-medium text-[12px] text-navy">
                      {option.label}
                    </span>
                    <span className="block font-body font-light text-[10px] mt-0.5 text-ink-faint">
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
            <p className="font-body font-light text-[10.5px] leading-relaxed mt-2.5 text-ink-faint">
              {selectedSpeed.arrival}
              {selectedSpeed.costLine ? ` — ${selectedSpeed.costLine}` : "."}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <GroupLabel>Account</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          <ProfileRow icon={ScrollText} label="Terms & privacy" onClick={onGoLegal} />
          <ProfileRow icon={LogOut} label="Log out" onClick={onSignOut} danger />
        </div>
      </div>
    </div>
  );
}
