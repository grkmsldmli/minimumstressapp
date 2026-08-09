"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Key, Lock, Sun, Users, Zap } from "lucide-react";

import { AccessPanel } from "@/components/access-panel";
import { BookingCalendar } from "@/components/booking-calendar";
import { SpaceGallery } from "@/components/space-gallery";
import { PrimaryButton } from "@/components/primitives";
import { slotStartsForDate } from "@/lib/availability";
import type { PublicSpace } from "@/lib/domain";
import {
  INSTANT_FEE_CENTS,
  MAX_UPCOMING_BOOKINGS_FREE,
  formatCents,
  isInstantSlot,
  isWithinBookingHorizon,
  quote,
} from "@/lib/money";
import { ACCESS_TYPES, requirementsByKind, roomTypeFor } from "@/lib/taxonomy";

/** How often the clock is re-read, so "Instant" reflects real time. */
const TICK_MS = 30_000;

/**
 * A slot's instant status is a function of the current time, not a flag on the
 * row. The prototype computed it once per render with nothing to trigger a
 * re-render, so a slot could sit on screen claiming a $5 fee it no longer
 * carried — or quietly acquire one.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface Slot {
  startsAt: Date;
  isInstant: boolean;
}

export function SpaceDetail({
  space,
  isPro,
  onBack,
  onBook,
  onGoPro,
  preview = false,
  error,
  startAt,
}: {
  space: PublicSpace;
  isPro: boolean;
  onBack: () => void;
  onBook: (startsAt: Date) => void | Promise<void>;
  /** Why the booking was refused. Silence here was the bug. */
  error?: string | null;
  /**
   * A slot to open on, from "book again".
   *
   * The shortcut is the hour, not the room: opening the listing and leaving
   * somebody to find Tuesday 2pm themselves is most of the work they were
   * trying to skip.
   */
  startAt?: Date | null;
  /**
   * True when the viewer is this listing's host.
   *
   * The screen is otherwise identical, deliberately — a preview that renders
   * differently from the thing it previews is worth nothing. Only the action
   * changes, because a host booking their own room is not a booking.
   */
  preview?: boolean;
  onGoPro: () => void;
}) {
  /* Itemisation is available on request, not led with. */
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [booking, setBooking] = useState(false);
  const now = useNow();
  /**
   * The day being looked at, as a date rather than an index.
   *
   * It was an offset into an eight-item strip, which only means anything while
   * the strip exists. A calendar can land on any day of any month.
   */
  const [day, setDay] = useState<Date>(() =>
    startAt
      ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate())
      : new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const [selected, setSelected] = useState<Date | null>(startAt ?? null);

  /*
   * The window is no longer computed here. The calendar owns which days are
   * offered, and `isWithinBookingHorizon` below is what actually refuses one —
   * so there is one rule rather than a screen-side copy that can drift from it,
   * which is exactly how a free account ended up being shown a single day long
   * after the rule had stopped agreeing.
   */
  const slots = useMemo<Slot[]>(() => {
    return slotStartsForDate(space.availability, day, space.bufferMinutes)
      .filter((startsAt) => startsAt.getTime() > now.getTime())
      .filter((startsAt) => isWithinBookingHorizon(startsAt, now, isPro))
      .map((startsAt) => ({ startsAt, isInstant: isInstantSlot(startsAt, now) }));
  }, [day, space.availability, space.bufferMinutes, now, isPro]);

  const isToday =
    day.getFullYear() === now.getFullYear() &&
    day.getMonth() === now.getMonth() &&
    day.getDate() === now.getDate();

  const selectedIsInstant = selected ? isInstantSlot(selected, now) : false;

  const priced = quote({
    hostRateCents: space.hourlyRateCents,
    isInstant: selectedIsInstant,
    isPro,
  });

  const accessLabel =
    ACCESS_TYPES.find((a) => a.key === space.accessType)?.label ?? "Keypad code";
  const requirementGroups = requirementsByKind(space.requirements);

  return (
    <div className="h-full flex flex-col relative screen-in bg-white">
      <SpaceGallery media={space.media} category={space.category} height={320}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press"
          style={{ backgroundColor: "rgba(255,255,255,0.22)", backdropFilter: "blur(8px)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div>
          <span
            className="px-2.5 py-1 rounded-full font-body text-[12px] text-white"
            style={{ backgroundColor: "rgba(255,255,255,0.2)", backdropFilter: "blur(6px)" }}
          >
            {roomTypeFor(space.category)}
          </span>
          <h2
            className="font-display italic font-semibold text-[28px] text-white leading-tight mt-2"
            style={{ textShadow: "0 2px 12px rgba(0,0,0,0.25)" }}
          >
            {space.name}
          </h2>
          <p className="font-body font-normal text-[13.5px] text-white/80 mt-0.5">
            {space.distanceLabel} · fits {space.capacity}
          </p>
        </div>
      </SpaceGallery>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-36">
        <p className="font-body font-normal text-[14.5px] leading-relaxed text-ink-muted">
          {space.description}
        </p>

        <div className="grid grid-cols-3 gap-2.5 mt-5">
          <Fact icon={Users} label="Fits" value={`${space.capacity} ppl`} />
          <Fact icon={Sun} label="Turnover" value={space.bufferMinutes === 0 ? "None" : `${space.bufferMinutes} min`} />
          <Fact icon={Key} label="Entry" value={accessLabel} />
        </div>

        {/*
          Four answered facts, where a single chip used to read "Wheelchair
          accessible". Somebody who uses a wheelchair could not act on that —
          a step at the door, a lift too narrow to turn in and an unusable
          restroom are all compatible with a ticked box — so they booked,
          travelled, paid, and could not get in.
        */}
        <Label>Getting in</Label>
        <AccessPanel details={space.access} />

        {space.amenities.length > 0 && (
          <>
            <Label>Good to know</Label>
            <div className="flex flex-wrap gap-1.5">
              {space.amenities.map((amenity) => (
                <Tag key={amenity}>{amenity}</Tag>
              ))}
            </div>
          </>
        )}

        {/*
          Above the slot grid on purpose. These are the things that would make
          someone choose a different room, and they are worthless below the
          moment of choosing — the same reasoning as showing the all-in price
          on the card rather than at checkout.
        */}
        {(requirementGroups.length > 0 || space.houseRules) && (
          <>
            <Label>Before you book</Label>
            <div
              className="rounded-2xl p-4"
              style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
            >
              {requirementGroups.map((group, i) => (
                <div key={group.kind} className={i > 0 ? "mt-3" : ""}>
                  <p className="font-body font-semibold text-[12px] uppercase tracking-[0.14em] text-warn mb-1.5">
                    {group.heading}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {group.items.map((item) => (
                      <li key={item.key} className="flex items-start gap-2">
                        <span
                          className="w-1 h-1 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: "#8B6C37" }}
                        />
                        <span className="font-body font-normal text-[13.5px] leading-relaxed text-[#7A5B33]">
                          {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {space.houseRules && (
                <p
                  className={`font-body font-normal text-[14px] leading-relaxed text-[#7A5B33] ${requirementGroups.length > 0 ? "mt-3 pt-3" : ""}`}
                  style={
                    requirementGroups.length > 0 ? { borderTop: "1px solid #F5DFC4" } : undefined
                  }
                >
                  {space.houseRules}
                </p>
              )}
            </div>
          </>
        )}

        <div
          className="mt-5 rounded-2xl p-3.5 flex items-start gap-2.5"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <Lock size={13} color="#8CA3BD" className="mt-0.5 shrink-0" />
          <div>
            {/*
              The town, then the rule. Showing neither was the same rule
              applied one level too far: nobody commits their card, their
              afternoon and their own client to a place they will not be told
              until afterwards.
            */}
            {space.area && (
              <p className="font-body font-medium text-[15px] text-navy">{space.area}</p>
            )}
            <p className="font-body font-normal text-[13.5px] leading-relaxed mt-0.5 text-ink-soft">
              The exact address and entry instructions are shared once you&apos;ve booked, shortly
              before your session.
            </p>
          </div>
        </div>

        <Label>Pick a day</Label>

        <div className="mb-4">
          <BookingCalendar
            availability={space.availability}
            selected={day}
            now={now}
            onPick={(picked: Date) => {
              setDay(picked);
              setSelected(null);
            }}
          />
        </div>


        {slots.length === 0 ? (
          <p className="font-body font-normal text-[14px] text-ink-faint">
            Nothing open {isToday ? "for the rest of today" : "on this day"}.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map(({ startsAt, isInstant }) => {
              const active = selected?.getTime() === startsAt.getTime();
              const chargesInstantFee = isInstant && !isPro;
              return (
                <button
                  key={startsAt.toISOString()}
                  type="button"
                  onClick={() => setSelected(startsAt)}
                  className={`relative py-3 rounded-xl font-body text-[14.5px] press transition-colors ${active ? "slot-pop" : ""}`}
                  style={{
                    backgroundColor: active ? "#16304E" : "#FFFFFF",
                    color: active ? "#fff" : "#16304E",
                    border: `1px solid ${active ? "#16304E" : chargesInstantFee ? "#F5DFC4" : "#DCE7F2"}`,
                  }}
                >
                  {isInstant && (
                    <span
                      className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full font-body text-[12px] font-medium"
                      style={{
                        backgroundColor: active ? "#8FC6F5" : chargesInstantFee ? "#FFF8F1" : "#EFF4EC",
                        color: active ? "#16304E" : chargesInstantFee ? "#8B6C37" : "#557255",
                        border: active
                          ? "none"
                          : `1px solid ${chargesInstantFee ? "#F5DFC4" : "#DCE6D6"}`,
                      }}
                    >
                      {chargesInstantFee ? "Instant" : "Free"}
                    </span>
                  )}
                  {startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </button>
              );
            })}
          </div>
        )}

        {!isPro && (
          <button
            type="button"
            onClick={onGoPro}
            className="w-full mt-3 rounded-2xl p-3.5 text-left press"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            <span className="flex items-center gap-1.5 font-body font-medium text-[15px] text-navy">
              <Zap size={12} color="#E8A23D" />
              Pro holds more than {MAX_UPCOMING_BOOKINGS_FREE} at once
            </span>
            <span className="block font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
              A free account holds {MAX_UPCOMING_BOOKINGS_FREE} sessions at a time. Pro also waives
              the {formatCents(INSTANT_FEE_CENTS)} instant fee and takes 10% off every booking.
            </span>
          </button>
        )}

        {/*
          One price, and the breakdown a tap away.
          A practitioner is choosing a room, not auditing a fee — leading with
          "Session $35, Service fee $7" made the number they pay the third
          thing on the card and invited them to price the two apart.
          It is not hidden, though, and that is deliberate rather than
          cautious: disclosing what a mandatory fee is and what it costs before
          somebody pays is a legal requirement in several places we will
          operate, and a price that cannot be itemised on request is the thing
          those rules exist to stop.
        */}
        <div
          className="mt-6 rounded-2xl p-4"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <div className="flex items-center gap-1.5">
            <Check size={11} color="#557255" />
            <p className="font-body font-semibold text-[12px] uppercase tracking-[0.14em] text-positive">
              All In Price — nothing added later
            </p>
          </div>

          <div className="flex items-baseline justify-between mt-2.5">
            <span className="font-display italic font-semibold text-[26px] text-navy">
              {formatCents(priced.totalCents)}
            </span>
            <span className="font-body font-normal text-[13.5px] text-ink-faint">an hour</span>
          </div>

          {priced.proDiscountCents > 0 && (
            <p className="font-body font-medium text-[15px] mt-1 text-positive">
              Pro discount applied — {formatCents(priced.proDiscountCents)} off
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowBreakdown((open) => !open)}
            className="font-body text-[15px] font-medium mt-2 press text-sky-text"
          >
            {showBreakdown ? "Hide breakdown" : "What's included?"}
          </button>

          {showBreakdown && (
            <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px solid #E7EEF6" }}>
              <Row label="Room" value={formatCents(priced.hostCents)} />
              <Row label="Service fee" value={formatCents(priced.serviceFeeCents)} />
              {priced.instantFeeCents > 0 && (
                <Row label="Instant booking" value={formatCents(priced.instantFeeCents)} />
              )}
              {priced.proDiscountCents > 0 && (
                <Row
                  label="Pro discount"
                  value={`-${formatCents(priced.proDiscountCents)}`}
                  positive
                />
              )}
            </div>
          )}
        </div>

        <div
          className="mt-3 rounded-2xl p-4 flex items-start gap-3"
          style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
        >
          <Check size={14} color="#3B9BE8" className="mt-0.5 shrink-0" />
          <p className="font-body font-normal text-[14px] leading-relaxed text-[#2E5578]">
            Your card is held, never charged, until the session starts — cancel 24 hours ahead for a
            full release. If the host ever cancels on you, you&apos;re refunded automatically, plus
            a credit for next time.
          </p>
        </div>
      </div>

      <div
        className="absolute bottom-0 inset-x-0 px-6 pt-4 pb-6"
        style={{ background: "linear-gradient(to top, #FFFFFF 75%, transparent)" }}
      >
        {/*
          Above the button, where somebody is already looking after pressing it.
          A booking can be refused for reasons nobody could have known about
          when they chose the hour — it was taken a second earlier, the host's
          payouts are unfinished, the session expired — and every one of those
          messages is written for the person reading it.
        */}
        {error && (
          <p className="font-body font-normal text-[14px] leading-relaxed mb-2.5 text-coral-deep">
            {error}
          </p>
        )}

        {preview ? (
          <PrimaryButton onClick={onBack}>Back to your studio</PrimaryButton>
        ) : (
        /*
          A disabled button reading "Choose a time" when there is no time to
          choose looks like the app is broken. It says which it is now.
        */
        <PrimaryButton
          disabled={!selected || booking}
          onClick={() => {
            if (!selected) return;
            setBooking(true);
            void Promise.resolve(onBook(selected)).finally(() => setBooking(false));
          }}
        >
          {booking
            ? "One moment…"
            : selected
              ? `Book ${selected.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${formatCents(priced.totalCents)}`
            : slots.length === 0
              ? isToday
                ? "Nothing left today"
                : "Nothing open this day"
              : "Choose a time"}
        </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div
      className="rounded-2xl p-3 text-center"
      style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
    >
      <Icon size={14} color="#3B9BE8" className="mx-auto" />
      <p className="font-body font-medium text-[15px] mt-1.5 text-navy">{value}</p>
      <p className="font-body text-[12px] uppercase tracking-wide mt-0.5 text-ink-faint">
        {label}
      </p>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-7 mb-3 text-sky-text">
      {children}
    </p>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full font-body text-[13.5px] text-ink-muted"
      style={{ backgroundColor: "#F4F8FC" }}
    >
      {children}
    </span>
  );
}

function Row({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div
      className={`flex justify-between font-body text-[13.5px] mb-1.5 ${positive ? "text-positive" : "text-ink-soft"}`}
    >
      <span>{label}</span>
      <span className={positive ? "" : "text-navy"}>{value}</span>
    </div>
  );
}
