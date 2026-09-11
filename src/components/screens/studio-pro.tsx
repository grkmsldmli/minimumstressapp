"use client";

import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import { errorMessage } from "@/lib/error-message";
import { FOUNDING_HOST_STUDIO_DISCOUNT, STUDIO_PRO_PRICE_CENTS, formatCents } from "@/lib/money";

const NAVY = "radial-gradient(140% 120% at 50% 0%, #1E4066 0%, #16304E 85%)";

const FEATURES = [
  "Post coverage to the whole board",
  "Structured listings — group or private, with the details that matter",
  "See applicants, confirm the one you want",
  "Class templates that prefill a post",
  "My Roster — invite your trusted substitutes",
  "Coverage history, duplicate & repost, urgent flags",
  "One subscription covers every space you run",
];

/**
 * Studio Pro — the host-account subscription that unlocks posting coverage.
 *
 * Mirrors ProScreen: it only ever opens hosted Stripe Checkout (or the billing
 * portal), never declares success itself, and turns "active" only once the
 * server (the webhook) confirms studio_pro. A Founding Host sees their free
 * window and permanent 50% rate stated honestly — no card is required to keep
 * the free months, and nothing auto-charges when they end.
 */
export function StudioProScreen({
  active,
  foundingFreeUntil,
  foundingDiscount,
  now,
  confirming = false,
  onSubscribe,
  onBack,
}: {
  /** Server-true Studio Pro (paid) or inside the Founding free period. */
  active: boolean;
  /** When the Founding free period ends, if the host is in one. */
  foundingFreeUntil: Date | null;
  /** This host carries the permanent Founding 50% entitlement. */
  foundingDiscount: boolean;
  /** The render's clock, passed in so this stays a pure component. */
  now: Date;
  /** Returned from checkout, waiting on the webhook. */
  confirming?: boolean;
  /** Opens checkout / billing portal. Rejects only if it could not open. */
  onSubscribe: () => Promise<unknown>;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const freeDaysLeft =
    foundingFreeUntil != null && foundingFreeUntil.getTime() > now.getTime()
      ? Math.max(1, Math.ceil((foundingFreeUntil.getTime() - now.getTime()) / 86_400_000))
      : null;
  const listPrice = STUDIO_PRO_PRICE_CENTS;
  const effectivePrice = foundingDiscount
    ? Math.round(listPrice * (1 - FOUNDING_HOST_STUDIO_DISCOUNT))
    : listPrice;

  if (active) {
    return (
      <div className="h-full flex flex-col screen-in bg-white">
        <div
          className="px-6 pt-8 safe-pt-8 pb-9 relative rounded-b-[30px] overflow-hidden text-center shrink-0"
          style={{ background: NAVY }}
        >
          <Ambient />
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center press absolute left-6 top-8 safe-top-8 z-20"
            style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
          >
            <ArrowLeft size={16} color="#fff" />
          </button>
          <div className="relative z-10 pt-1 flex flex-col items-center">
            <span
              className="px-2.5 py-0.5 rounded-full font-body font-bold text-[11px] tracking-wide text-white"
              style={{ backgroundColor: "#2578C2" }}
            >
              STUDIO PRO
            </span>
            <div className="mt-3 flex justify-center">
              <Headline pre="You're" accent="Studio Pro." size={26} light />
            </div>
            {freeDaysLeft != null ? (
              <p className="font-body font-normal text-[14px] text-white/70 leading-relaxed mt-3">
                Free for {freeDaysLeft} more {freeDaysLeft === 1 ? "day" : "days"} as a Founding Host.
                Nothing is charged, and it only continues if you choose to — then at your permanent
                50% rate ({formatCents(effectivePrice)}/mo).
              </p>
            ) : (
              <p className="font-body font-normal text-[14px] text-white/70 leading-relaxed mt-3">
                Post coverage, see applicants, keep templates and your roster — across every space
                you run.
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-6">
          <ul className="flex flex-col gap-2.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <Check size={16} color="#2578C2" className="mt-0.5 shrink-0" />
                <span className="font-body font-normal text-[14px] text-navy leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-6 pb-7 safe-pb-7 shrink-0">
          {failed && (
            <p
              className="font-body font-normal text-[14px] leading-relaxed mb-3 rounded-xl p-3"
              style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
              role="alert"
            >
              {failed}
            </p>
          )}
          <PrimaryButton
            disabled={busy}
            onClick={() => {
              setFailed(null);
              setBusy(true);
              void onSubscribe()
                .catch((cause) => setFailed(errorMessage(cause, "Could not open billing.")))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "One moment…" : freeDaysLeft != null ? "Manage subscription" : "Manage billing"}
          </PrimaryButton>
          <button
            type="button"
            onClick={onBack}
            className="w-full text-center font-body font-medium text-[14px] mt-3 text-ink-faint press"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="h-full flex flex-col screen-in bg-white items-center justify-center text-center px-9">
        <Headline pre="Confirming your" accent="subscription." size={22} />
        <p className="font-body font-normal text-[13.5px] text-ink-soft mt-3">This only takes a moment.</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 font-body font-medium text-[14px] text-sky-text press"
        >
          Back
        </button>
      </div>
    );
  }

  const ctaLabel = busy
    ? "One moment…"
    : freeDaysLeft != null
      ? "Start free — no card needed"
      : `Get Studio Pro — ${formatCents(effectivePrice)}/mo`;

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 safe-pt-8 pb-9 relative rounded-b-[30px] overflow-hidden text-center shrink-0"
        style={{ background: NAVY }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press absolute left-6 top-8 safe-top-8 z-20"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="relative z-10 pt-1 flex flex-col items-center">
          <span
            className="px-2.5 py-0.5 rounded-full font-body font-bold text-[11px] tracking-wide text-white"
            style={{ backgroundColor: "#2578C2" }}
          >
            STUDIO PRO
          </span>
          <div className="mt-3 flex justify-center">
            <Headline pre="Post" accent="coverage." size={28} light />
          </div>
          {freeDaysLeft != null ? (
            <>
              <p className="font-display italic font-semibold text-white mt-3" style={{ fontSize: 32 }}>
                Free for 6 months
              </p>
              <p className="font-body font-normal text-[13.5px] text-white/65 mt-1">
                then {formatCents(effectivePrice)}/mo · your permanent Founding rate
              </p>
            </>
          ) : (
            <p className="font-display italic font-semibold text-white mt-3" style={{ fontSize: 38 }}>
              {foundingDiscount && (
                <span className="font-body font-normal text-[16px] text-white/45 line-through mr-2">
                  {formatCents(listPrice)}
                </span>
              )}
              {formatCents(effectivePrice)}
              <span className="font-body font-normal text-[15.5px] text-white/60">/mo</span>
            </p>
          )}
          {foundingDiscount && freeDaysLeft == null && (
            <p className="font-body font-normal text-[13px] text-white/65 mt-1">
              Founding Host · 50% for life
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-6">
        <ul className="flex flex-col gap-2.5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <Check size={16} color="#2578C2" className="mt-0.5 shrink-0" />
              <span className="font-body font-normal text-[14px] text-navy leading-snug">{f}</span>
            </li>
          ))}
        </ul>
        {freeDaysLeft != null && (
          <p className="font-body font-normal text-[12.5px] text-ink-faint mt-5 leading-relaxed">
            No card required for your free months, and nothing auto-charges when they end. You choose
            whether to continue.
          </p>
        )}
      </div>

      <div className="px-6 pb-7 safe-pb-7 shrink-0">
        {failed && (
          <p
            className="font-body font-normal text-[14px] leading-relaxed mb-3 rounded-xl p-3"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
            role="alert"
          >
            {failed}
          </p>
        )}
        <PrimaryButton
          disabled={busy}
          onClick={() => {
            setFailed(null);
            setBusy(true);
            void onSubscribe()
              .catch((cause) =>
                setFailed(errorMessage(cause, "That did not go through. Nothing was charged.")),
              )
              .finally(() => setBusy(false));
          }}
        >
          {ctaLabel}
        </PrimaryButton>
        <p className="text-center font-body font-normal text-[13.5px] mt-2.5 text-ink-faint">
          One subscription covers all your spaces. Cancel anytime.
        </p>
      </div>
    </div>
  );
}
