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
 * What it costs, on both sides.
 *
 * Every figure is read from lib/money rather than typed. A pricing page that
 * disagrees with checkout is the one page somebody quotes back at you.
 */

export const metadata: Metadata = {
  title: "Pricing & Fees",
  description:
    "One price on every listing, and that is what you pay. Hosts keep their full rate — our " +
    "fee is added on top.",
  alternates: { canonical: `${WEBSITE}/pricing` },
};

const CANCEL_HOURS = FREE_CANCEL_WINDOW_MS / 3_600_000;
const FEE_PERCENT = Math.round(SERVICE_FEE_RATE * 100);

const EXAMPLE_RATE = 5000;
const EXAMPLE_FEE = Math.round(EXAMPLE_RATE * SERVICE_FEE_RATE);

export default function PricingPage() {
  return (
    <PageShell
      eyebrow="Pricing"
      title={<>Simple pricing, both ways.</>}
      standfirst="One price on the listing, and that is what you pay. Hosts keep their full rate."
    >
      <Section title="Booking a room">
        <p>
          You see one price and you pay that price. Our fee is already inside it.
        </p>

        <div className="grid gap-3 pt-2 sm:grid-cols-3">
          <Figure
            value={formatCents(EXAMPLE_RATE)}
            label="The host's rate"
            note="They set it. They keep all of it."
          />
          <Figure
            value={formatCents(EXAMPLE_FEE)}
            label={`Our fee, ${FEE_PERCENT}%`}
            note="Added on top, not taken out."
          />
          <Figure
            value={formatCents(EXAMPLE_RATE + EXAMPLE_FEE)}
            label="You pay"
            note="The price shown on the listing."
          />
        </div>

        <p>
          You are charged when you book. Cancel {CANCEL_HOURS} hours or more before your session
          and the session is refunded — the card processing fee is the only thing kept, and Pro
          covers that too.
        </p>
        <p>
          Booking a room that starts within the next two hours adds{" "}
          {formatCents(INSTANT_FEE_CENTS)}. That is the only other charge.
        </p>
      </Section>

      <Section title="Listing a room">
        <p>
          We take nothing from your rate. You set an hourly price, the practitioner pays that plus
          our {FEE_PERCENT}% fee, and your full rate reaches your bank after each session.
        </p>
        <p>Listing is free. No monthly charge, no minimum, no commitment.</p>

        <Reveal>
          <div
            className="rounded-2xl p-6"
            style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
          >
            <p className={TYPE.body} style={{ color: COLOUR.body }}>
              Set your rate at {formatCents(EXAMPLE_RATE)} an hour and you receive{" "}
              {formatCents(EXAMPLE_RATE)} an hour. The practitioner pays{" "}
              {formatCents(EXAMPLE_RATE + EXAMPLE_FEE)}.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section title="Pro, if you book a lot">
        <p>
          {formatCents(PRO_PRICE_CENTS)} a month for practitioners. It does not change what a
          session costs.
        </p>
        <p>
          It lifts the limit on how many bookings you can hold at once, from{" "}
          {MAX_UPCOMING_BOOKINGS_FREE} to as many as you like, and lets you book{" "}
          {PRO_BOOKING_HORIZON_DAYS} days ahead instead of {BOOKING_HORIZON_DAYS} — enough to plan
          a full term with your clients.
        </p>
        <p>Hosts are not affected by it either way.</p>
      </Section>

      <Section title="Common questions">
        <dl className="space-y-6">
          <QA q="Is there a booking fee I will see later?">
            No. The listing price is the total for that room, and the breakdown is shown before
            you confirm. The one thing that can add to it is booking a slot starting within two
            hours, which is marked on the slot itself.
          </QA>
          <QA q="When am I charged?">
            When you book. Cancel more than {CANCEL_HOURS} hours ahead and you are refunded, apart
            from the card processing fee.
          </QA>
          <QA q="Does the host lose out if I cancel?">
            No. Hosts are paid for sessions that happen, and a refund comes from us.
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
