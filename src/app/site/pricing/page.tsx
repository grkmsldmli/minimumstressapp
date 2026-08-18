import type { Metadata } from "next";

import { Onward, PageShell, QA, Section } from "@/components/site/page-shell";
import { Reveal } from "@/components/site/reveal";
import { WEBSITE } from "@/lib/company";
import {
  BOOKING_HORIZON_DAYS,
  FREE_CANCEL_WINDOW_MS,
  INSTANT_FEE_CENTS,
  MAX_UPCOMING_BOOKINGS_FREE,
  PRO_BOOKING_HORIZON_DAYS,
  PRO_PRICE_CENTS,
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

const EXAMPLE_RATE = 5000;

export default function PricingPage() {
  return (
    <PageShell
      eyebrow="Pricing"
      title={<>Simple pricing, both ways.</>}
      standfirst="One price on the listing, and that is what you pay. Hosts keep their full rate."
    >
      {/*
        One number, and no arithmetic behind it.
        This page used to print the split — the host's rate, our cut as a
        percentage, and the total — in three cards. Two things wrong with that.
        It is the company's margin, published, for every competitor to price
        against and every host to negotiate over. And it made the price look
        like a sum with a fee bolted on, when the whole promise is that the
        number on the listing is the number you pay.
        Nothing is hidden by removing it. California's rule on this is that the
        advertised price must already contain every compulsory fee, which is
        what a single all-in figure is; itemising the parts is not required and
        never was the thing that made it honest.
      */}
      <Section title="Booking a room">
        <p>
          The price on the listing is the price you pay. There is nothing added at checkout, no
          booking fee, and no charge for having an account.
        </p>
        <p>
          You are charged when you book. Where a host accepts bookings themselves, your card is
          held instead and the money is only taken if they accept — if they decline, or do not
          answer within a day, the hold is released and nothing is taken.
        </p>
        <p>
          Cancel {CANCEL_HOURS} hours or more before your session and you are refunded — the card
          processing fee is the only thing kept, and Pro covers that too.
        </p>
        <p>
          Booking a room that starts within the next two hours adds{" "}
          {formatCents(INSTANT_FEE_CENTS)}. That is the only other charge.
        </p>
      </Section>

      <Section title="Listing a room">
        <p>
          You set your rate and you receive all of it. We take nothing out of what you charge, and
          your full rate reaches your bank after each session.
        </p>
        <p>Listing is free. No monthly charge, no minimum, no commitment.</p>

        <Reveal>
          <div
            className="rounded-2xl p-6"
            style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
          >
            <p className={TYPE.body} style={{ color: COLOUR.body }}>
              Set your rate at {formatCents(EXAMPLE_RATE)} and {formatCents(EXAMPLE_RATE)} is what
              reaches you. Not {formatCents(EXAMPLE_RATE)} less commission.
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
            No. The listing price is the total for that room. The one thing that can add to it is
            booking a slot starting within two hours, which is marked on the slot itself.
          </QA>
          <QA q="When am I charged?">
            When you book. On a room where the host accepts bookings themselves, your card is held
            instead and only taken if they accept. Cancel more than {CANCEL_HOURS} hours ahead and
            you are refunded, apart from the card processing fee.
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
