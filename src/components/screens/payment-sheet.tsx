"use client";

import { useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ArrowLeft, Check, Lock } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PawLoader } from "@/components/paw-loader";
import { PrimaryButton } from "@/components/primitives";
import type { BookingMoneyRecord } from "@/lib/domain";
import { cancellationCostCents, earlyCancellationRefundCents, formatCents } from "@/lib/money";
import { LATE_CANCELLATION_HOURS } from "@/lib/reliability";
import { STRIPE_APPEARANCE, stripeBrowser } from "@/lib/stripe/browser";
import { sessionWhen } from "@/lib/when";

/**
 * Paying, without leaving the app.
 *
 * The brief asks for Embedded Components rather than a Checkout redirect, and
 * the reason shows up here: the All In Price breakdown sits beside the card
 * fields, so the number being charged is visible at the moment of paying it.
 * A redirect would hand that off to a page we do not control.
 *
 * Nothing on this screen decides an amount. The PaymentIntent was created and
 * priced server-side; this collects a card and confirms it.
 */
export function PaymentSheet({
  clientSecret,
  money,
  spaceName,
  startsAt,
  timeZone,
  onBack,
  onPaid,
}: {
  clientSecret: string;
  money: BookingMoneyRecord;
  spaceName: string;
  startsAt: Date;
  /** The room's zone. This screen names the hour being paid for. */
  timeZone: string;
  onBack: () => void;
  onPaid: () => void;
}) {
  return (
    <Elements
      stripe={stripeBrowser()}
      options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
    >
      <SheetBody
        money={money}
        spaceName={spaceName}
        startsAt={startsAt}
        timeZone={timeZone}
        onBack={onBack}
        onPaid={onPaid}
      />
    </Elements>
  );
}

function SheetBody({
  money,
  spaceName,
  startsAt,
  timeZone,
  onBack,
  onPaid,
}: {
  money: BookingMoneyRecord;
  spaceName: string;
  startsAt: Date;
  timeZone: string;
  onBack: () => void;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      // Stays on this screen unless the card demands a redirect for 3-D Secure,
      // which is what "if_required" means — the common path never leaves.
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/` },
    });

    if (stripeError) {
      // Stripe's messages are written for cardholders and are better than
      // anything generic we would put here.
      setError(stripeError.message ?? "That card was declined.");
      setBusy(false);
      return;
    }

    onPaid();
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
          disabled={busy}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-20"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="mt-3 relative z-10">
          <Headline pre="Book the" accent="hour." size={24} light />
        </div>
        <p className="font-body font-normal text-[14px] text-white/65 mt-1 relative z-10">
          {spaceName} ·{" "}
          {sessionWhen(startsAt, timeZone)}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {/* The same breakdown as the listing, so the total cannot surprise. */}
        <div
          className="rounded-2xl p-4 mb-5"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <div className="flex items-center gap-1.5 mb-3">
            <Check size={11} color="#557255" />
            {/* Shortened with the listing's copy of it, which wrapped to two
                lines here and said the same thing twice in both places. */}
            <p className="font-body font-semibold text-[12px] uppercase tracking-[0.14em] text-positive">
              Nothing added later
            </p>
          </div>
          <Row label="Session" value={formatCents(money.hostRateCents)} />
          <Row label="Service fee" value={formatCents(money.serviceFeeCents)} />
          {money.instantFeeCents > 0 && (
            <Row label="Instant booking" value={formatCents(money.instantFeeCents)} />
          )}
          {money.proDiscountCents > 0 && (
            <Row label="Pro discount" value={`-${formatCents(money.proDiscountCents)}`} positive />
          )}
          <div className="h-px my-2" style={{ backgroundColor: "#E7EEF6" }} />
          <div className="flex justify-between font-body font-semibold text-[15px] text-navy">
            <span>Charged now</span>
            <span>{formatCents(money.totalCents)}</span>
          </div>
        </div>

        <div
          className="rounded-2xl p-3.5 mb-5 flex items-start gap-2.5"
          style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
        >
          <Lock size={13} color="#3B9BE8" className="mt-0.5 shrink-0" />
          <div>
            {/*
              This said "a hold, not a charge" long after the money started
              being taken at booking. Copy on the one screen where somebody is
              handing over a card has to describe what the button does.
            */}
            {/*
              Two paragraphs of about seventy words used to sit here, on the
              one screen where somebody is holding a card and deciding. Both
              facts are worth stating — and the second has to be stated, since
              Stripe records the card-on-file mandate at this exact moment and
              a saved card nobody was told about is the thing that rule exists
              to prevent — but neither had to be a paragraph. Two sentences,
              one fact each, and the figures still spelled out rather than
              rounded to a reassuring shape.
            */}
            <p className="font-body font-normal text-[13.5px] leading-relaxed text-[#2E5578]">
              Cancel {LATE_CANCELLATION_HOURS} hours ahead and{" "}
              {formatCents(earlyCancellationRefundCents(money.totalCents))} comes back. The{" "}
              {formatCents(cancellationCostCents(money.totalCents))} card fee is kept either way.
            </p>
            <p className="font-body font-normal text-[13.5px] leading-relaxed mt-2 text-[#2E5578]">
              Your card is saved for next time. It is charged again only for damage, cleaning or
              overtime, and only after we ask — amounts are in the terms.
            </p>
          </div>
        </div>

        {/*
          Card is the only method on the intent (see payment-methods.ts), so
          this keeps the two wallets that ride on it in hand: Apple Pay stays,
          Google Pay is turned off, leaving Card + Apple Pay. Link is not a
          wallet here and is governed by the Stripe account, not this option.
        */}
        <PaymentElement
          options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "never" } }}
        />

        {error && (
          <p
            className="font-body font-normal text-[14px] leading-relaxed mt-3 rounded-xl p-3"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        {/*
          The confirm is a real network wait. The button keeps its exact size and
          position and stays disabled — only its inner label swaps for the brand's
          inline paw loader, so nothing shifts when processing begins. Same
          submit, timing, and success/error paths.
        */}
        <PrimaryButton disabled={!stripe || busy} onClick={submit}>
          {busy ? (
            <PawLoader size={13} inline label="Processing your booking…" />
          ) : (
            `Pay ${formatCents(money.totalCents)}`
          )}
        </PrimaryButton>
        <p className="text-center font-body font-normal text-[12px] mt-2.5 text-ink-faint">
          Card details go straight to Stripe. They never touch our servers.
        </p>
      </div>
    </div>
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
