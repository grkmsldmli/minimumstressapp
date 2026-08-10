"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  MessageCircle,
} from "lucide-react";

import { Ambient, BreathingLogo, Headline, categoryGradient } from "@/components/brand";
import { BreathCoach } from "@/components/breath-coach";
import { ConfettiBurst } from "@/components/primitives";
import { SpaceDirections } from "@/components/space-directions";
import { CancellationConsequence } from "@/components/standing-notice";
import type { Booking, SpaceAccessDetails } from "@/lib/domain";
import { PRO_PRICE_CENTS, formatCents, isFreeCancellation } from "@/lib/money";
import type { Standing } from "@/lib/reliability";

/* ------------------------------------------------------------------ */
/*  Confirmed                                                          */
/* ------------------------------------------------------------------ */

export function Confirmed({
  booking,
  access,
  onDone,
  onGoPro,
  showProUpsell,
}: {
  booking: Booking;
  access: SpaceAccessDetails | null;
  onDone: () => void;
  onGoPro: () => void;
  showProUpsell: boolean;
}) {
  const startLabel = booking.startsAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const dayLabel = isToday(booking.startsAt)
    ? "today"
    : booking.startsAt.toLocaleDateString("en-US", { weekday: "long" });

  return (
    <div
      className="h-full flex flex-col items-center text-center px-9 py-10 screen-in relative overflow-y-auto"
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, #1E4066 0%, #16304E 55%, #0E2138 100%)",
      }}
    >
      <Ambient />
      <ConfettiBurst />
      <div className="relative z-10 flex flex-col items-center w-full">
        <BreathingLogo size={120} />
        <div className="mt-6">
          <Headline pre="The room is" accent="yours." size={26} light />
        </div>
        <p className="font-body font-normal text-[14.5px] text-white/70 leading-relaxed mt-3">
          {booking.spaceName} · {startLabel} {dayLabel}.
        </p>

        <AccessPanel booking={booking} access={access} />

        <div
          className="w-full mt-3 rounded-2xl p-4 text-left"
          style={{
            backgroundColor: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <DarkRow label="Session" value={formatCents(booking.hostRateCents)} />
          <DarkRow label="Service fee" value={formatCents(booking.serviceFeeCents)} />
          {booking.instantFeeCents > 0 && (
            <DarkRow label="Instant booking" value={formatCents(booking.instantFeeCents)} />
          )}
          {booking.proDiscountCents > 0 && (
            <DarkRow
              label="Pro discount"
              value={`-${formatCents(booking.proDiscountCents)}`}
              positive
            />
          )}
          <div className="h-px my-2.5" style={{ backgroundColor: "rgba(255,255,255,0.12)" }} />
          <div className="flex justify-between font-body font-semibold text-[14.5px] text-white">
            <span>Held on your card</span>
            <span>{formatCents(booking.totalCents)}</span>
          </div>
          <p className="font-body font-normal text-[13.5px] text-white/50 mt-2 leading-relaxed">
            Not charged yet. We capture it when the session starts.
          </p>
        </div>

        {showProUpsell && (
          <button
            type="button"
            onClick={onGoPro}
            className="w-full mt-3 rounded-2xl p-3.5 flex items-center justify-between press"
            style={{
              backgroundColor: "rgba(242,105,92,0.12)",
              border: "1px solid rgba(242,105,92,0.3)",
            }}
          >
            <span className="text-left">
              <span className="block font-body font-medium text-[15px] text-coral-soft">
                Skip this fee with Pro
              </span>
              <span className="block font-body font-normal text-[13.5px] text-white/50 mt-0.5">
                {formatCents(PRO_PRICE_CENTS)}/mo · unlimited instant booking
              </span>
            </span>
            <ChevronRight size={16} color="#F2A79E" />
          </button>
        )}

        <BreathCoach />

        <button
          type="button"
          onClick={onDone}
          className="mt-5 px-8 py-3.5 rounded-full font-body font-medium text-[14.5px] text-white press"
          style={{ backgroundColor: "#2578C2" }}
        >
          Back to spaces
        </button>
      </div>
    </div>
  );
}

/**
 * The access code and address, or an honest explanation of when they arrive.
 *
 * The code exists from the moment of booking but the server withholds it until
 * half an hour before — so this panel reports the wait rather than pretending
 * to hold something it does not have.
 */
function AccessPanel({
  booking,
  access,
}: {
  booking: Booking;
  access: SpaceAccessDetails | null;
}) {
  const revealed = booking.revealedAccessCode;

  return (
    <div
      className="w-full mt-6 rounded-2xl p-4 text-left"
      style={{
        backgroundColor: revealed ? "rgba(143,198,245,0.12)" : "rgba(255,255,255,0.07)",
        border: `1px solid ${revealed ? "rgba(143,198,245,0.3)" : "rgba(255,255,255,0.12)"}`,
      }}
    >
      <div className="flex items-center gap-2">
        <KeyRound size={13} color="#8FC6F5" />
        <p className="font-body font-medium text-[13.5px] uppercase tracking-[0.14em] text-sky-soft">
          Getting in
        </p>
      </div>

      {revealed ? (
        <p className="font-display italic font-semibold text-[30px] text-white mt-2 tracking-[0.18em]">
          {revealed}
        </p>
      ) : (
        <p className="font-body font-normal text-[13.5px] text-white/65 mt-2 leading-relaxed">
          Your code is generated and waiting. It appears here at{" "}
          {booking.accessCodeRevealedAt.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
          , half an hour before you start.
        </p>
      )}

      <div className="h-px my-3" style={{ backgroundColor: "rgba(255,255,255,0.12)" }} />

      {access ? (
        <SpaceDirections access={access} tone="dark" />
      ) : (
        /*
          Said, rather than left as an absence.
          The address arrives on the same line the money does: inside 24 hours
          a cancellation is charged in full, so that is the point the booking
          is committed. Silence here would read as something missing.
        */
        <p className="font-body font-normal text-[14px] leading-relaxed text-white/65">
          The exact address and entry instructions appear here a day before your session, once the
          booking is confirmed. You already know the area.
        </p>
      )}
    </div>
  );
}

function DarkRow({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex justify-between font-body text-[13.5px] mt-2 first:mt-0">
      <span className="font-normal text-white/70">{label}</span>
      <span style={{ color: positive ? "#9AD4B8" : "#fff" }}>{value}</span>
    </div>
  );
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/* ------------------------------------------------------------------ */
/*  My Bookings                                                        */
/* ------------------------------------------------------------------ */

export function MyBookings({
  bookings,
  accessFor,
  standing,
  onBack,
  onCancel,
  onReview,
  onMessage,
}: {
  bookings: Booking[];
  accessFor: (spaceId: string) => SpaceAccessDetails | null;
  standing: Standing;
  onBack: () => void;
  onCancel: (id: string) => void;
  /** Offered on a finished session that has not been reviewed yet. */
  onReview?: (id: string) => void;
  /** Opens the thread for a booking. */
  onMessage?: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const upcoming = bookings.filter((b) => b.status === "upcoming");
  const past = bookings.filter((b) => b.status !== "upcoming");

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
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
        </div>
        <div className="mt-3 relative z-10">
          <Headline pre="Your" accent="bookings." size={24} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">

        <SectionLabel>Upcoming</SectionLabel>
        {upcoming.length === 0 && (
          <p className="font-body font-normal text-[14px] text-ink-faint">Nothing booked yet.</p>
        )}

        <div className="flex flex-col gap-2.5">
          {upcoming.map((booking) => (
            <UpcomingBooking
              key={booking.id}
              booking={booking}
              access={accessFor(booking.spaceId)}
              now={now}
              standing={standing}
              open={openId === booking.id}
              onToggle={() => setOpenId(openId === booking.id ? null : booking.id)}
              onMessage={onMessage ? () => onMessage(booking.id) : undefined}
              onCancel={() => {
                onCancel(booking.id);
                setOpenId(null);
              }}
            />
          ))}
        </div>

        {past.length > 0 && (
          <>
            <div className="mt-7">
              <SectionLabel>Past</SectionLabel>
            </div>
            <div className="flex flex-col gap-2">
              {past.map((booking) => {
                /*
                  A cancelled session is not reviewable — nobody was in the
                  room, so there is nothing to report, and the reliability
                  rules already handle a repeated canceller.
                */
                const reviewable =
                  onReview && booking.status === "completed" && booking.endsAt < now;

                return (
                  <div
                    key={booking.id}
                    className="p-3 rounded-xl"
                    style={{ backgroundColor: "#F9FAFB" }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-body font-medium text-[14.5px] text-navy truncate">
                          {booking.spaceName} · {booking.roomType}
                        </p>
                        <p className="font-body font-normal text-[13.5px] text-ink-faint">
                          {booking.startsAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                          {booking.status === "cancelled_by_host" && " · refunded and credited"}
                        </p>
                      </div>
                      <StatusPill status={booking.status} />
                    </div>

                    {reviewable && (
                      <button
                        type="button"
                        onClick={() => onReview(booking.id)}
                        className="w-full mt-2.5 py-2.5 rounded-xl font-body font-medium text-[15px] press bg-white"
                        style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
                      >
                        How was it? Leave a review
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UpcomingBooking({
  booking,
  access,
  now,
  standing,
  open,
  onToggle,
  onCancel,
  onMessage,
}: {
  booking: Booking;
  access: SpaceAccessDetails | null;
  now: Date;
  standing: Standing;
  open: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onMessage?: () => void;
}) {
  const [from, to] = categoryGradient(booking.category);
  // Derived from the real start time, so the warning changes as the session
  // approaches. The prototype hardcoded 30 hours on every non-instant booking,
  // which meant cancellation was always free and the rule never bound.
  const freeToCancel = isFreeCancellation(booking.startsAt, now);
  const codeReady = Boolean(booking.revealedAccessCode);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid #E7EEF6", boxShadow: "0 4px 14px -8px rgba(22,48,78,0.12)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3.5 p-3 text-left press bg-white"
      >
        <div
          className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center"
          style={{ background: `radial-gradient(120% 120% at 25% 15%, ${from}, ${to})` }}
        >
          <Calendar size={18} color="rgba(255,255,255,0.92)" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body font-medium text-[15px] text-navy truncate">
            {booking.spaceName} · {booking.roomType}
          </p>
          <p className="font-body font-normal text-[14px] mt-0.5 text-ink-soft">
            {booking.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
            {booking.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ·{" "}
            {formatCents(booking.totalCents)}
          </p>
          {codeReady && (
            <p className="font-body font-medium text-[15px] mt-0.5 text-sky-text">
              Code {booking.revealedAccessCode}
            </p>
          )}
        </div>
        <ChevronDown
          size={16}
          color="#B9CBDD"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
        />
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 card-in" style={{ backgroundColor: "#F9FAFB" }}>
          <div
            className="rounded-xl p-3 mb-3"
            style={{
              backgroundColor: codeReady ? "#EDF6FE" : "#fff",
              border: `1px solid ${codeReady ? "#D4E8FA" : "#E7EEF6"}`,
            }}
          >
            <p className="flex items-center gap-1.5 font-body font-semibold text-[12px] uppercase tracking-[0.14em] text-sky-text mb-1.5">
              <KeyRound size={11} /> Getting in
            </p>
            {codeReady ? (
              <p className="font-display italic font-semibold text-[24px] text-navy tracking-[0.18em]">
                {booking.revealedAccessCode}
              </p>
            ) : (
              <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-soft">
                Your code appears here at{" "}
                {booking.accessCodeRevealedAt.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                , half an hour before you start.
              </p>
            )}
            {access ? (
              <div className="mt-3">
                <SpaceDirections access={access} showMap />
              </div>
            ) : (
              <p className="font-body font-normal text-[14px] leading-relaxed mt-3 text-ink-soft">
                The address appears a day before your session.
              </p>
            )}

            {/*
              Offered on an upcoming session, which is when there is something
              to ask — where to park, a door that will not open, running late.
              Neither side ever sees the other's number, so this is the only
              way to ask.
            */}
            {onMessage && (
              <button
                type="button"
                onClick={onMessage}
                className="w-full mt-3 py-2.5 rounded-xl font-body font-medium text-[15px] press flex items-center justify-center gap-1.5"
                style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
              >
                <MessageCircle size={13} /> Message the studio
              </button>
            )}
          </div>

          <div
            className="rounded-xl p-3 mb-3 flex items-start gap-2.5"
            style={{
              backgroundColor: freeToCancel ? "#EDF6FE" : "#FEF2F0",
              border: `1px solid ${freeToCancel ? "#D4E8FA" : "#F5C4BC"}`,
            }}
          >
            {freeToCancel ? (
              <Check size={13} color="#3B9BE8" className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={13} color="#B45143" className="mt-0.5 shrink-0" />
            )}
            <p
              className="font-body font-normal text-[13.5px] leading-relaxed"
              style={{ color: freeToCancel ? "#2E5578" : "#7A4A42" }}
            >
              {freeToCancel
                ? "More than 24 hours away — cancel now for a full release. Your card was only ever held."
                : `Less than 24 hours away. Cancelling now still charges ${formatCents(booking.totalCents)}.`}
            </p>
          </div>

          {/*
            The standing consequence appears only when cancelling would
            actually count — inside the window. Showing it on a booking three
            days out would be a threat about something that carries no penalty.
          */}
          {!freeToCancel && <CancellationConsequence party="practitioner" standing={standing} />}

          <button
            type="button"
            onClick={onCancel}
            className="w-full py-3 rounded-xl font-body font-medium text-[14.5px] press bg-white text-danger mt-3"
            style={{ border: "1px solid #F5C4BC" }}
          >
            Cancel booking
          </button>

        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Booking["status"] }) {
  const style = {
    cancelled_by_practitioner: { bg: "#FEF2F0", fg: "#B45143", label: "Cancelled" },
    cancelled_by_host: { bg: "#EDF6FE", fg: "#3B9BE8", label: "Host cancelled" },
    no_show: { bg: "#FEF2F0", fg: "#B45143", label: "No-show" },
    completed: { bg: "#EFF4EC", fg: "#557255", label: "Completed" },
    upcoming: { bg: "#EFF4EC", fg: "#557255", label: "Upcoming" },
  }[status];

  return (
    <span
      className="px-2.5 py-1 rounded-full font-body text-[15px] font-medium shrink-0"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      {style.label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-3 text-sky-text">
      {children}
    </p>
  );
}
