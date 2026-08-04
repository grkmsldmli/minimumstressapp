"use client";

import { useEffect, useMemo, useState } from "react";
import { Accessibility, ArrowLeft, Bath, Check, Key, Lock, Sun, Users, Zap } from "lucide-react";

import { CatIcon, categoryGradient } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import { slotStartsForDate } from "@/lib/availability";
import type { PublicSpace } from "@/lib/domain";
import {
  INSTANT_FEE_CENTS,
  PRO_HORIZON_DAYS,
  formatCents,
  isInstantSlot,
  isWithinBookingHorizon,
  quote,
} from "@/lib/money";
import { ACCESS_TYPES, roomTypeFor } from "@/lib/taxonomy";

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
  creditBalanceCents,
  onBack,
  onBook,
  onGoPro,
}: {
  space: PublicSpace;
  isPro: boolean;
  creditBalanceCents: number;
  onBack: () => void;
  onBook: (startsAt: Date) => void;
  onGoPro: () => void;
}) {
  const now = useNow();
  const [dayOffset, setDayOffset] = useState(0);
  const [selected, setSelected] = useState<Date | null>(null);

  const horizonDays = isPro ? PRO_HORIZON_DAYS : 0;

  // Midnight today, as a number. Only the calendar day matters for the day
  // tabs, so keying off this rather than `now` stops the 30-second tick
  // rebuilding the list and resetting the user's chosen day.
  const dayStamp = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const days = useMemo(() => {
    const base = new Date(dayStamp);
    return Array.from(
      { length: horizonDays + 1 },
      (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + i),
    );
  }, [horizonDays, dayStamp]);

  const slots = useMemo<Slot[]>(() => {
    const day = days[Math.min(dayOffset, days.length - 1)];
    if (!day) return [];
    return slotStartsForDate(space.availability, day, space.bufferMinutes)
      .filter((startsAt) => startsAt.getTime() > now.getTime())
      .filter((startsAt) => isWithinBookingHorizon(startsAt, now, isPro))
      .map((startsAt) => ({ startsAt, isInstant: isInstantSlot(startsAt, now) }));
  }, [days, dayOffset, space.availability, space.bufferMinutes, now, isPro]);

  const selectedIsInstant = selected ? isInstantSlot(selected, now) : false;

  const priced = quote({
    hostRateCents: space.hourlyRateCents,
    isInstant: selectedIsInstant,
    isPro,
    creditBalanceCents,
  });

  const [from, to] = categoryGradient(space.category);
  const accessLabel =
    ACCESS_TYPES.find((a) => a.key === space.accessType)?.label ?? "Keypad code";

  return (
    <div className="h-full flex flex-col relative screen-in bg-white">
      <div
        className="h-[240px] shrink-0 relative overflow-hidden"
        style={{ background: `radial-gradient(150% 130% at 20% 0%, ${from} 0%, ${to} 85%)` }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <CatIcon cat={space.category} size={30} color="rgba(255,255,255,0.9)" />
        </div>
        <div className="absolute inset-0 flex flex-col justify-between p-6">
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
              className="px-2.5 py-1 rounded-full font-body text-[10px] text-white"
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
            <p className="font-body font-light text-[12px] text-white/80 mt-0.5">
              {space.distanceLabel} · fits {space.capacity}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-36">
        <p className="font-body font-light text-[13px] leading-relaxed text-ink-muted">
          {space.description}
        </p>

        <div className="grid grid-cols-3 gap-2.5 mt-5">
          <Fact icon={Users} label="Fits" value={`${space.capacity} ppl`} />
          <Fact icon={Sun} label="Turnover" value={space.bufferMinutes === 0 ? "None" : `${space.bufferMinutes} min`} />
          <Fact icon={Key} label="Entry" value={accessLabel} />
        </div>

        <Label>Good to know</Label>
        <div className="flex flex-wrap gap-1.5">
          {space.accessible !== null && (
            <Tag>
              <Accessibility size={11} color={space.accessible ? "#5E7D5E" : "#B08D4F"} />
              {space.accessible ? "Wheelchair accessible" : "Not wheelchair accessible"}
            </Tag>
          )}
          {space.restroom && (
            <Tag>
              <Bath size={11} color="#3B9BE8" />
              {space.restroom === "None" ? "No restroom on site" : `${space.restroom} restroom`}
            </Tag>
          )}
          {space.amenities.map((amenity) => (
            <Tag key={amenity}>{amenity}</Tag>
          ))}
        </div>

        <div
          className="mt-5 rounded-2xl p-3.5 flex items-start gap-2.5"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <Lock size={13} color="#8CA3BD" className="mt-0.5 shrink-0" />
          <p className="font-body font-light text-[11px] leading-relaxed text-ink-soft">
            The address and entry instructions are shared once you&apos;ve booked. Your door code
            arrives 30 minutes before the session, and it is unique to your booking.
          </p>
        </div>

        <Label>{isPro ? "Open hours" : "Today's open hours"}</Label>

        {days.length > 1 && (
          <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
            {days.map((day, i) => (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => {
                  setDayOffset(i);
                  setSelected(null);
                }}
                className="px-3.5 py-2 rounded-full font-body text-[12px] whitespace-nowrap press"
                style={{
                  backgroundColor: dayOffset === i ? "#16304E" : "#fff",
                  color: dayOffset === i ? "#fff" : "#16304E",
                  border: `1px solid ${dayOffset === i ? "#16304E" : "#DCE7F2"}`,
                }}
              >
                {i === 0
                  ? "Today"
                  : day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
              </button>
            ))}
          </div>
        )}

        {slots.length === 0 ? (
          <p className="font-body font-light text-[12.5px] text-ink-faint">
            Nothing open {dayOffset === 0 ? "for the rest of today" : "on this day"}.
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
                  className={`relative py-3 rounded-xl font-body text-[13px] press transition-colors ${active ? "slot-pop" : ""}`}
                  style={{
                    backgroundColor: active ? "#16304E" : "#FFFFFF",
                    color: active ? "#fff" : "#16304E",
                    border: `1px solid ${active ? "#16304E" : chargesInstantFee ? "#F5DFC4" : "#DCE7F2"}`,
                  }}
                >
                  {isInstant && (
                    <span
                      className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full font-body text-[8px] font-medium"
                      style={{
                        backgroundColor: active ? "#8FC6F5" : chargesInstantFee ? "#FFF8F1" : "#EFF4EC",
                        color: active ? "#16304E" : chargesInstantFee ? "#B08D4F" : "#5E7D5E",
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
            <span className="flex items-center gap-1.5 font-body font-medium text-[12px] text-navy">
              <Zap size={12} color="#E8A23D" />
              Pro books up to {PRO_HORIZON_DAYS} days ahead
            </span>
            <span className="block font-body font-light text-[11px] mt-0.5 text-ink-soft">
              Without it, bookings are same-day only — and instant slots cost{" "}
              {formatCents(INSTANT_FEE_CENTS)}.
            </span>
          </button>
        )}

        {/* All In Price — shown before the choice is made, not only at checkout. */}
        <div
          className="mt-6 rounded-2xl p-4"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <div className="flex items-center gap-1.5 mb-3">
            <Check size={11} color="#5E7D5E" />
            <p className="font-body font-medium text-[10px] uppercase tracking-[0.14em] text-positive">
              All In Price — nothing added later
            </p>
          </div>

          <Row label="Session" value={formatCents(priced.hostCents)} />
          <Row label="Service fee" value={formatCents(priced.serviceFeeCents)} />
          {priced.instantFeeCents > 0 && (
            <Row label="Instant booking" value={formatCents(priced.instantFeeCents)} />
          )}
          {priced.proDiscountCents > 0 && (
            <Row label="Pro discount" value={`-${formatCents(priced.proDiscountCents)}`} positive />
          )}
          {priced.creditAppliedCents > 0 && (
            <Row
              label="Credit applied"
              value={`-${formatCents(priced.creditAppliedCents)}`}
              positive
            />
          )}

          <div className="h-px my-2" style={{ backgroundColor: "#E7EEF6" }} />
          <div className="flex justify-between font-body font-semibold text-[13.5px] text-navy">
            <span>Total</span>
            <span>{formatCents(priced.totalCents)}</span>
          </div>
          <p className="font-body font-light text-[10.5px] leading-relaxed mt-2.5 text-ink-faint">
            The service fee helps us verify every space, protect your booking, and keep the app
            running.
          </p>
        </div>

        <div
          className="mt-3 rounded-2xl p-4 flex items-start gap-3"
          style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
        >
          <Check size={14} color="#3B9BE8" className="mt-0.5 shrink-0" />
          <p className="font-body font-light text-[11.5px] leading-relaxed text-[#2E5578]">
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
        <PrimaryButton disabled={!selected} onClick={() => selected && onBook(selected)}>
          {selected
            ? `Book ${selected.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${formatCents(priced.totalCents)}`
            : "Choose a time"}
        </PrimaryButton>
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
      <p className="font-body font-medium text-[11.5px] mt-1.5 text-navy">{value}</p>
      <p className="font-body text-[9.5px] uppercase tracking-wide mt-0.5 text-ink-faint">
        {label}
      </p>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] mt-7 mb-3 text-sky">
      {children}
    </p>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full font-body text-[11px] text-ink-muted"
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
      className={`flex justify-between font-body text-[12px] mb-1.5 ${positive ? "text-positive" : "text-ink-soft"}`}
    >
      <span>{label}</span>
      <span className={positive ? "" : "text-navy"}>{value}</span>
    </div>
  );
}
