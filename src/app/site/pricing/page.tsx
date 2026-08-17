import type { Metadata } from "next";

import { Figure, Onward, PageShell, QA, Section } from "@/components/site/page-shell";
import { Reveal } from "@/components/site/reveal";
import { WEBSITE } from "@/lib/company";
import {
  BOOKING_HORIZON_DAYS,
  FREE_CANCEL_WINDOW_MS,
  INSTANT_FEE_CENTS,
  MAX_UPCOMING_BOOKINGS_FREE,
  PRO_BOOKING_HORIZON_DAYS,
  PRO_PRICE_CENTS,
  SERVICE_FEE_RATE,
  formatCents,
} from "@/lib/money";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * What it costs, on both sides, with nothing held back for checkout.
 *
 * Every figure here is read off lib/money rather than typed. A pricing page
 * that disagrees with the checkout screen is worse than no pricing page: it is
 * the one page somebody will quote back, and being wrong on it is the kind of
 * wrong that ends in a refund and a review.
 *
 * The structure follows the only question that matters on each side. A
 * practitioner asks "what will I actually pay", so the answer is the whole
 * price and where the fee sits. A host asks "what do you take", and the answer
 * is nothing — the fee is added on top and the practitioner pays it, which is
 * unusual enough that saying it plainly is worth more than any other sentence
 * on the page.
 */

export const metadata: Metadata = {
  title: "Pricing & Fees",
  description:
    "What a booking costs, what a host keeps, and the fee in between. The price on a listing " +
    "is the price you pay — no fee revealed at checkout.",
  alternates: { canonical: `${WEBSITE}/pricing` },
};

const CANCEL_HOURS = FREE_CANCEL_WINDOW_MS / 3_600_000;
const FEE_PERCENT = Math.round(SERVICE_FEE_RATE * 100);

/** A worked example, computed rather than written, at an ordinary rate. */
const EXAMPLE_RATE = 5000;
const EXAMPLE_FEE = Math.round(EXAMPLE_RATE * SERVICE_FEE_RATE);

export default function PricingPage() {
  return (
    <PageShell
      eyebrow="Pricing & fees"
      title={<>What it costs, both ways.</>}
      standfirst={
        `The price on a listing is the price a practitioner pays. The host keeps their rate in ` +
        `full — the ${FEE_PERCENT}% fee is added on top, not taken out.`
      }
    >
      <Section title="If you are booking a room">
        <p>
          You see one number on the listing and you pay that number. The fee is already in it, so
          nothing appears at checkout that was not on the page you decided from.
        </p>

        <div className="grid gap-3 pt-2 sm:grid-cols-3">
          <Figure
            value={formatCents(EXAMPLE_RATE)}
            label="The host's rate"
            note="Set by them, and theirs to keep."
          />
          <Figure
            value={formatCents(EXAMPLE_FEE)}
            label={`Service fee, ${FEE_PERCENT}%`}
            note="What the platform charges, on top."
          />
          <Figure
            value={formatCents(EXAMPLE_RATE + EXAMPLE_FEE)}
            label="What you pay"
            note="The figure shown on the listing."
          />
        </div>

        <p>
          Your card is charged when you book, not on the day. Cancel at least {CANCEL_HOURS} hours
          before the session and the charge is voided — the money never leaves, rather than leaving
          and coming back a week later.
        </p>
        <p>
          A slot starting within the next two hours is an instant booking and carries a further{" "}
          {formatCents(INSTANT_FEE_CENTS)}. That is the only other charge there is.
        </p>
      </Section>

      <Section title="If you are letting a room">
        <p>
          Nothing is deducted. You set an hourly rate, the practitioner pays that plus the{" "}
          {FEE_PERCENT}% fee, and your rate reaches your bank after each session — so what you
          write on the listing is what you receive.
        </p>
        <p>
          Listing is free, there is no monthly charge, and there is no minimum. Stripe handles the
          payout and its processing cost comes out of the platform&rsquo;s share, not yours.
        </p>

        <Reveal>
          <div
            className="rounded-2xl p-6"
            style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
          >
            <p className={TYPE.body} style={{ color: COLOUR.body }}>
              At {formatCents(EXAMPLE_RATE)} an hour you receive {formatCents(EXAMPLE_RATE)} an
              hour. The practitioner pays {formatCents(EXAMPLE_RATE + EXAMPLE_FEE)}.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section title="Pro, which is optional and practitioner-side only">
        <p>
          {formatCents(PRO_PRICE_CENTS)} a month, and it changes nothing about what a session
          costs. It lifts the cap on how many bookings a free account may hold at once —{" "}
          {MAX_UPCOMING_BOOKINGS_FREE} — and extends how far ahead you can book from{" "}
          {BOOKING_HORIZON_DAYS} days to {PRO_BOOKING_HORIZON_DAYS}, which is the difference
          between booking week to week and booking a term.
        </p>
        <p>
          It deliberately does not discount the fee. A subscription that gets cheaper the more
          somebody books loses most on the person it was sold to, so Pro buys room on the calendar
          instead — and hosts are not affected by it either way.
        </p>
      </Section>

      <Section title="Questions people actually ask">
        <dl className="space-y-6">
          <QA q="Is there a booking fee I will see later?">
            No. The figure on the listing is the total. The fee is inside it and named in the
            breakdown before you confirm.
          </QA>
          <QA q="When am I charged?">
            When you book. Cancel more than {CANCEL_HOURS} hours ahead and it is voided rather than
            refunded, so nothing appears on your statement at all.
          </QA>
          <QA q="Does the host lose anything if I cancel?">
            No. A cancellation inside the free window refunds from the platform&rsquo;s balance,
            and the host is only ever paid for sessions that happened.
          </QA>
          <QA q="What does it cost to list a space?">
            Nothing to list, nothing per month, and nothing taken from your rate.
          </QA>
        </dl>

        <Onward href="/spaces">Find a space</Onward>
      </Section>
    </PageShell>
  );
}
