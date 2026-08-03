"use client";

import { useState } from "react";
import { Check, Zap } from "lucide-react";

import {
  Ambient,
  BreathingLogo,
  CatIcon,
  Headline,
  Wordmark,
  categoryGradient,
} from "@/components/brand";
import { PrimaryButton, Toggle } from "@/components/primitives";
import { WeekSchedule } from "@/components/week-schedule";
import { type AvailabilityBlock, isValidSchedule, slotStartsForDate } from "@/lib/availability";
import { formatCents, minViableHostRateCents, quote } from "@/lib/money";
import { CATEGORIES } from "@/lib/taxonomy";

type Tab = "pricing" | "schedule" | "design";

/**
 * Foundation preview. Not a product screen — a place to see the design system
 * and the money rules working before either is wired to real data.
 */
export default function FoundationPreview() {
  const [tab, setTab] = useState<Tab>("pricing");

  return (
    <main className="w-full flex flex-col items-center gap-6 py-10 px-4">
      <header className="text-center">
        <div className="flex justify-center">
          <Wordmark size={13} />
        </div>
        <div className="mt-3">
          <Headline pre="Foundation" accent="preview." size={26} />
        </div>
        <p className="font-body font-light text-[12.5px] text-ink-soft mt-2 max-w-[420px]">
          The design system and the pricing rules, before anything touches a database or a card.
        </p>
      </header>

      <nav className="flex gap-2">
        {(["pricing", "schedule", "design"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="px-4 py-2 rounded-full font-body text-[12px] press capitalize"
            style={{
              backgroundColor: tab === key ? "#3B9BE8" : "#fff",
              color: tab === key ? "#fff" : "#16304E",
              border: `1px solid ${tab === key ? "#3B9BE8" : "#DCE7F2"}`,
            }}
          >
            {key}
          </button>
        ))}
      </nav>

      <PhoneFrame>
        {tab === "pricing" && <PricingPlayground />}
        {tab === "schedule" && <SchedulePlayground />}
        {tab === "design" && <DesignPlayground />}
      </PhoneFrame>
    </main>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden bg-white"
      style={{
        width: 385,
        height: 780,
        borderRadius: 44,
        border: "9px solid #16304E",
        boxShadow: "0 40px 90px -30px rgba(22,48,78,0.45)",
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pricing — the All In Price, driven by the real money module         */
/* ------------------------------------------------------------------ */

function PricingPlayground() {
  const [hostRateDollars, setHostRateDollars] = useState(45);
  const [isInstant, setIsInstant] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [creditDollars, setCreditDollars] = useState(0);

  const hostRateCents = Math.round(hostRateDollars * 100);
  const q = quote({
    hostRateCents,
    isInstant,
    isPro,
    creditBalanceCents: Math.round(creditDollars * 100),
  });

  return (
    <div className="h-full flex flex-col screen-in bg-white overflow-y-auto">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
      >
        <Ambient />
        <div className="relative z-10">
          <Headline pre="All In" accent="Price." size={24} light />
          <p className="font-body font-light text-[11.5px] text-white/65 mt-1">
            Every fee shown up front, wherever a price appears.
          </p>
        </div>
      </div>

      <div className="px-6 pt-5 pb-8 flex flex-col gap-4">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="font-body text-[11px] text-ink-soft">
              Host rate <span className="text-ink-ghost">(they keep this)</span>
            </span>
            <span className="font-body font-semibold text-[13px] text-navy">
              {formatCents(hostRateCents)}/hr
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={200}
            step={1}
            value={hostRateDollars}
            aria-label="Host hourly rate"
            onChange={(e) => setHostRateDollars(Number(e.target.value))}
            className="w-full accent-sky"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="font-body text-[11px] text-ink-soft">Credit balance</span>
            <span className="font-body font-semibold text-[13px] text-navy">
              {formatCents(Math.round(creditDollars * 100))}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={creditDollars}
            aria-label="Credit balance"
            onChange={(e) => setCreditDollars(Number(e.target.value))}
            className="w-full accent-sky"
          />
        </div>

        <div className="flex flex-col gap-2">
          <SwitchRow
            label="Instant slot"
            sub="Starts within 2 hours"
            on={isInstant}
            onToggle={() => setIsInstant((v) => !v)}
          />
          <SwitchRow
            label="Pro member"
            sub="Waives instant fees, 10% off"
            on={isPro}
            onToggle={() => setIsPro((v) => !v)}
          />
        </div>

        {/* The practitioner-facing breakdown */}
        <div
          className="rounded-2xl p-4"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <div className="flex items-center gap-1.5 mb-3">
            <Check size={11} color="#5E7D5E" />
            <p className="font-body font-medium text-[10px] uppercase tracking-[0.14em] text-positive">
              All In Price — nothing added later
            </p>
          </div>

          <Line label="Session" value={formatCents(q.hostCents)} />
          <Line label="Service fee" value={formatCents(q.serviceFeeCents)} />
          {q.instantFeeCents > 0 && (
            <Line label="Instant booking" value={formatCents(q.instantFeeCents)} />
          )}
          {q.proDiscountCents > 0 && (
            <Line label="Pro discount" value={`-${formatCents(q.proDiscountCents)}`} positive />
          )}
          {q.creditAppliedCents > 0 && (
            <Line label="Credit applied" value={`-${formatCents(q.creditAppliedCents)}`} positive />
          )}

          <div className="h-px my-2" style={{ backgroundColor: "#E7EEF6" }} />
          <div className="flex justify-between font-body font-semibold text-[13.5px] text-navy">
            <span>Total</span>
            <span>{formatCents(q.totalCents)}</span>
          </div>
        </div>

        {/* What the host and the platform actually see */}
        <div className="grid grid-cols-2 gap-2.5">
          <Stat
            label="Host receives"
            value={formatCents(q.hostCents)}
            note="Exactly their rate"
            tone="positive"
          />
          <Stat
            label="Platform keeps"
            value={formatCents(q.platformNetCents)}
            note="After Stripe's cut"
            tone={q.platformNetCents >= 0 ? "neutral" : "danger"}
          />
        </div>

        {q.creditAppliedCents > 0 && q.creditRemainingCents > 0 && (
          <div
            className="rounded-2xl p-3.5 flex items-start gap-2.5"
            style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
          >
            <Zap size={13} color="#3B9BE8" className="mt-0.5 shrink-0" />
            <p className="font-body font-light text-[11px] leading-relaxed text-[#2E5578]">
              {formatCents(q.creditRemainingCents)} of credit stays on the account. Redemption stops
              where our cut would no longer cover processing, so the host is never touched and we
              never pay to be generous.
            </p>
          </div>
        )}

        {hostRateCents < minViableHostRateCents(isPro) && (
          <div
            className="rounded-2xl p-3.5"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC" }}
          >
            <p className="font-body font-light text-[11px] leading-relaxed text-[#7A4A42]">
              Below {formatCents(minViableHostRateCents(isPro))}/hr a percentage fee cannot cover
              Stripe&apos;s flat 30&cent;, so this booking loses money whatever the credit does. The
              brief sets no minimum rate — worth choosing one well above this.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({
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

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "positive" | "neutral" | "danger";
}) {
  const palette = {
    positive: { bg: "#EFF4EC", border: "#DCE6D6" },
    neutral: { bg: "#F4F8FC", border: "#E7EEF6" },
    danger: { bg: "#FEF2F0", border: "#F5C4BC" },
  }[tone];

  return (
    <div
      className="rounded-2xl p-3.5"
      style={{ backgroundColor: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <p className="font-body text-[9.5px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="font-display italic font-semibold text-[20px] mt-1 text-navy">{value}</p>
      <p className="font-body font-light text-[10px] mt-0.5 text-ink-faint">{note}</p>
    </div>
  );
}

function SwitchRow({
  label,
  sub,
  on,
  onToggle,
}: {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-3.5 rounded-xl bg-white"
      style={{ border: "1px solid #E7EEF6" }}
    >
      <div className="pr-3">
        <p className="font-body font-medium text-[13px] text-navy">{label}</p>
        <p className="font-body font-light text-[11px] mt-0.5 text-ink-faint">{sub}</p>
      </div>
      <Toggle on={on} onClick={onToggle} label={label} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Schedule — multiple blocks per day, with real validation           */
/* ------------------------------------------------------------------ */

function SchedulePlayground() {
  // The brief's own example: one Monday, three blocks, real gaps between.
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([
    { weekday: 1, startMinute: 7 * 60, endMinute: 8 * 60 },
    { weekday: 1, startMinute: 14 * 60, endMinute: 15 * 60 },
    { weekday: 1, startMinute: 17 * 60, endMinute: 21 * 60 },
  ]);

  const aMonday = new Date(2026, 7, 3);
  const slots = isValidSchedule(blocks) ? slotStartsForDate(blocks, aMonday) : [];

  return (
    <div className="h-full flex flex-col screen-in bg-white overflow-y-auto">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <div className="relative z-10">
          <Headline pre="Open more" accent="hours." size={22} light />
          <p className="font-body font-light text-[11.5px] text-white/65 mt-1">
            Repeats weekly. Several blocks a day, with the gaps kept for yourself.
          </p>
        </div>
      </div>

      <div className="px-6 pt-5 pb-8">
        <WeekSchedule blocks={blocks} onChange={setBlocks} />

        <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] mt-6 mb-2 text-sky">
          Monday&apos;s bookable slots
        </p>
        {slots.length === 0 ? (
          <p className="font-body font-light text-[12px] text-ink-faint">
            {isValidSchedule(blocks)
              ? "Nothing open on Mondays."
              : "Fix the highlighted blocks to see slots."}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((slot) => (
              <div
                key={slot.toISOString()}
                className="py-2.5 rounded-xl text-center font-body text-[12.5px] text-navy"
                style={{ border: "1px solid #DCE7F2" }}
              >
                {slot.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Design — brand marks and the locked taxonomy                       */
/* ------------------------------------------------------------------ */

function DesignPlayground() {
  return (
    <div
      className="h-full flex flex-col screen-in relative overflow-y-auto"
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, #1E4066 0%, #16304E 55%, #0E2138 100%)",
      }}
    >
      <Ambient />
      <div className="relative z-10 px-8 pt-10 pb-8 flex flex-col items-center">
        <Wordmark size={13} />
        <div className="mt-5 text-center">
          <Headline pre="Space for your" accent="mind, body & spirit." size={26} light />
        </div>

        <div className="my-8">
          <BreathingLogo size={150} />
        </div>
        <p className="font-body font-light text-[11px] text-white/50 tracking-[0.12em] uppercase">
          4 · 7 · 8, nineteen seconds a cycle
        </p>

        <div className="w-full mt-9">
          <p className="font-body font-medium text-[10.5px] uppercase tracking-[0.2em] text-sky-soft mb-3">
            The four categories
          </p>
          <div className="flex flex-col gap-2.5">
            {CATEGORIES.map((category) => {
              const [from, to] = categoryGradient(category.key);
              return (
                <div
                  key={category.key}
                  className="flex items-center gap-3 p-3 rounded-2xl"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center"
                    style={{ background: `radial-gradient(120% 120% at 25% 15%, ${from}, ${to})` }}
                  >
                    <CatIcon cat={category.key} size={17} color="rgba(255,255,255,0.92)" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-body font-medium text-[12.5px] text-white">
                      {category.roomType}
                    </p>
                    <p className="font-body font-light text-[10.5px] text-white/55 mt-0.5">
                      {category.label}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-full mt-8">
          <PrimaryButton>Begin</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
