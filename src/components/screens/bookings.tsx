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
  Share2,
} from "lucide-react";

import { Ambient, BreathingLogo, Headline, categoryGradient } from "@/components/brand";
import { BreathCoach } from "@/components/breath-coach";
import { ConfettiBurst } from "@/components/primitives";
import { SpaceDirections } from "@/components/space-directions";
import { CancellationConsequence } from "@/components/standing-notice";
import type { Booking, SpaceAccessDetails } from "@/lib/domain";
import { shareTextFor } from "@/lib/share-session";
import {
  PRO_PRICE_CENTS,
  cancellationCostCents,
  earlyCancellationRefundCents,
  formatCents,
  isFreeCancellation,
} from "@/lib/money";
import { LATE_CANCELLATION_HOURS, type Standing } from "@/lib/reliability";
import { REFUND_WINDOW_DAYS, canRequestRefund } from "@/lib/refunds";
import { sessionDate, sessionTime, sessionWeekday } from "@/lib/when";

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
  const startLabel = sessionTime(booking.startsAt, booking.timeZone);
  const dayLabel = isToday(booking.startsAt)
    ? "today"
    : sessionWeekday(booking.startsAt, booking.timeZone);

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
            <span>Paid</span>
            <span>{formatCents(booking.totalCents)}</span>
          </div>
          <p className="font-body font-normal text-[13.5px] text-white/50 mt-2 leading-relaxed">
            Cancel 24 hours or more before your session and{" "}
            {formatCents(earlyCancellationRefundCents(booking.totalCents))} comes back — everything
            except the {formatCents(cancellationCostCents(booking.totalCents))} card fee, which the
            payment network keeps either way.
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
              {/*
                "Skip this fee with Pro" was offered directly under an instant
                fee somebody had just paid, and Pro does not skip it —
                quote() charges it to everyone, deliberately. Selling a
                subscription on the fee it does not remove is the worst
                version of this mistake: it is read at the moment the fee is
                on screen.

                What Pro does do for somebody who has just booked is give
                them the whole amount back if they change their mind in time.
              */}
              <span className="block font-body font-medium text-[15px] text-coral-soft">
                Change your mind for nothing, with Pro
              </span>
              <span className="block font-body font-normal text-[13.5px] text-white/50 mt-0.5">
                {formatCents(PRO_PRICE_CENTS)}/mo · cancel {LATE_CANCELLATION_HOURS}h ahead and
                the card fee comes back too
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
 * Sending the details to whoever is coming with them.
 *
 * A booking has a third person the app has never known about: the client who
 * has to find the building. The practitioner was reading the address off this
 * screen and retyping it into a message.
 *
 * The phone's own share sheet does the sending, so SMS, WhatsApp and mail all
 * work without us implementing any of them — and, more to the point, without
 * us asking for the client's number. We store nothing about them, they never
 * agreed to our terms, and the practitioner keeps their own client
 * relationship, which is theirs rather than ours to hold.
 *
 * The door code is not in the message and cannot be: shareTextFor has no
 * parameter for one. See share-session.ts.
 */
function ShareWithClient({
  booking,
  addressLine,
  isPro,
  onGoPro,
}: {
  booking: Booking;
  addressLine: string | null;
  isPro: boolean;
  onGoPro: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const send = async () => {
    if (!isPro) {
      onGoPro();
      return;
    }

    const { title, body } = shareTextFor({
      spaceName: booking.spaceName,
      startsAt: booking.startsAt,
      timeZone: booking.timeZone,
      addressLine,
    });

    /*
     * The share sheet where there is one, the clipboard where there is not.
     *
     * Desktop browsers and a few mobile ones have no navigator.share, and a
     * button that silently does nothing is worse than no button. Copying is
     * the same job with one more step, and saying so is what makes it obvious
     * the tap worked.
     */
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, text: body });
        return;
      }
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Cancelling the share sheet rejects. That is somebody changing their
      // mind, not a failure, and it needs no message.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void send()}
      className="w-full mt-2 py-2.5 rounded-xl font-body font-medium text-[15px] press flex items-center justify-center gap-1.5"
      style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
    >
      <Share2 size={13} />
      {copied ? "Copied" : isPro ? "Share with your client" : "Share with your client — Pro"}
    </button>
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
          Said, rather than left as an absence. The address is on the listing
          from the start; what appears here is the way in, and it appears when
          it is useful rather than when it is booked.

          Two lead times, because there are two things. The instructions open a
          day ahead — `space_access_details` gates on `starts_at - now() < 24
          hours` — and the code half an hour ahead, on ACCESS_CODE_LEAD_MS.
          This line claimed thirty minutes for both, which is the same screen
          promising something later than it arrives and, a screen away in
          MyBookings, contradicting itself.
        */
        <p className="font-body font-normal text-[14px] leading-relaxed text-white/65">
          Entry instructions appear here a day before, and your door code half an hour before you
          start.
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

/**
 * Whether this session can still be asked about.
 *
 * The same two rules the server applies, so the link is never offered for a
 * request the route would refuse — a button that leads to a refusal is worse
 * than no button.
 */
function refundable(booking: Booking, now: Date): boolean {
  const daysSince = (now.getTime() - booking.startsAt.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSince > REFUND_WINDOW_DAYS) return false;

  return canRequestRefund({
    status: booking.status,
    paidCents: booking.totalCents,
    refundedCents: 0,
  });
}

export function MyBookings({
  bookings,
  accessFor,
  addressFor,
  isPro,
  onGoPro,
  standing,
  onBack,
  onCancel,
  onReview,
  onAskRefund,
  onMessage,
}: {
  bookings: Booking[];
  accessFor: (spaceId: string) => SpaceAccessDetails | null;
  /** The public street, which exists from the moment a room is listed. */
  addressFor: (spaceId: string) => string | null;
  isPro: boolean;
  onGoPro: () => void;
  standing: Standing;
  onBack: () => void;
  onCancel: (id: string) => void;
  /** Offered on a finished session that has not been reviewed yet. */
  onReview?: (id: string) => void;
  /** Absent for a host, who asks through a claim rather than a refund. */
  onAskRefund?: (id: string) => void;
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
              addressLine={addressFor(booking.spaceId)}
              isPro={isPro}
              onGoPro={onGoPro}
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
                        {/* Same truncation as the upcoming card above, same cut. */}
                        <p className="font-body font-medium text-[15px] text-navy truncate">
                          {booking.spaceName}
                        </p>
                        <p className="font-body font-normal text-[13.5px] text-ink-faint">
                          {sessionDate(booking.startsAt, booking.timeZone)}
                          {booking.status === "cancelled_by_host" && " · refunded in full"}
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

                    {/*
                      Underneath the review rather than beside it, and quieter.
                      Most sessions are fine; a refund link with equal weight
                      invites the thought rather than answering it.
                    */}
                    {onAskRefund && refundable(booking, now) && (
                      <button
                        type="button"
                        onClick={() => onAskRefund(booking.id)}
                        className="w-full mt-2 py-2 font-body text-[13.5px] press"
                        style={{ color: "#8CA3BD" }}
                      >
                        Something went wrong with this session
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
  addressLine,
  isPro,
  onGoPro,
}: {
  booking: Booking;
  access: SpaceAccessDetails | null;
  now: Date;
  standing: Standing;
  open: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onMessage?: () => void;
  /**
   * From the public listing, not from `access`.
   *
   * `access` arrives a day before the session and carries the door code with
   * it. The street is public from the moment a room is listed, and somebody
   * telling a client where to be next Tuesday should not have to wait until
   * Monday to do it.
   */
  addressLine: string | null;
  isPro: boolean;
  onGoPro: () => void;
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
          {/*
            The room type came off the end of this line, which meant a name
            like "Reformer Hit · Movement Studio" truncated mid-word and cost
            the half somebody recognises. The tile to the left is already
            coloured and iconed by category, so the words were repeating a
            picture at the price of the name.
          */}
          <p className="font-body font-medium text-[15px] text-navy truncate">
            {booking.spaceName}
          </p>
          <p className="font-body font-normal text-[14px] mt-0.5 text-ink-soft">
            {sessionDate(booking.startsAt, booking.timeZone)} ·{" "}
            {sessionTime(booking.startsAt, booking.timeZone)} ·{" "}
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
              <p className="font-body font-normal text-[13.5px] leading-relaxed mt-3 text-ink-soft">
                {/*
                  This said the address appears a day before the session, and
                  it stopped being true in 0032 — the address is on the listing
                  from the moment the room is published, because these are
                  retail studios whose address is on their own website. The
                  screen was describing a restriction that had been removed,
                  sending somebody away to wait for something already in front
                  of them.

                  What is still held back is the part that gets you inside.
                */}
                Entry instructions appear a day before your session.
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

            <ShareWithClient
              booking={booking}
              addressLine={addressLine}
              isPro={isPro}
              onGoPro={onGoPro}
            />
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
              {/*
                The exact figure, before the button rather than after it. A
                refund that arrives smaller than expected is how somebody
                learns about a fee from their bank statement instead of us.
              */}
              {freeToCancel
                ? `Cancel now and ${formatCents(earlyCancellationRefundCents(booking.totalCents))} comes back, in a few working days. The ${formatCents(cancellationCostCents(booking.totalCents))} card fee is kept either way.`
                : `Cancel now and none of the ${formatCents(booking.totalCents)} comes back — the studio held the hour for you.`}
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
