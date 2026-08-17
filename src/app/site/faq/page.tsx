import Link from "next/link";
import type { Metadata } from "next";

import { PageShell, QA, Section } from "@/components/site/page-shell";
import { APP_URL, BRAND, WEBSITE } from "@/lib/company";
import {
  BOOKING_HORIZON_DAYS,
  FREE_CANCEL_WINDOW_MS,
  INSTANT_FEE_CENTS,
  PRO_BOOKING_HORIZON_DAYS,
  SERVICE_FEE_RATE,
  formatCents,
} from "@/lib/money";
import { COLOUR } from "@/lib/site-theme";

/**
 * The questions, answered where somebody is asking them.
 *
 * Split by side rather than by topic, because nobody arrives with a general
 * interest in the marketplace — they arrive as one of two people with about
 * six questions each, and a single list mixing "how do I get in" with "when am
 * I paid" makes both of them read half a page that is not for them.
 *
 * The numbers come from lib/money, so this page cannot drift from what the app
 * charges. That has happened to every FAQ ever written by hand.
 */

export const metadata: Metadata = {
  title: "Questions",
  description:
    "How booking a room by the hour works, what it costs, when you get in, and how listing a " +
    "space works from the other side.",
  alternates: { canonical: `${WEBSITE}/faq` },
};

const CANCEL_HOURS = FREE_CANCEL_WINDOW_MS / 3_600_000;
const FEE_PERCENT = Math.round(SERVICE_FEE_RATE * 100);

function Inline({ href, children }: { href: string; children: React.ReactNode }) {
  return href.startsWith("/") ? (
    <Link href={href} className="underline underline-offset-2" style={{ color: COLOUR.link }}>
      {children}
    </Link>
  ) : (
    <a href={href} className="underline underline-offset-2" style={{ color: COLOUR.link }}>
      {children}
    </a>
  );
}

export default function FaqPage() {
  return (
    <PageShell
      eyebrow="Questions"
      title={<>The things worth asking first.</>}
      standfirst="Booking a room is on the left of this page and letting one is on the right. Most people only need one half."
    >
      <Section title="Booking a room">
        <dl className="space-y-6">
          <QA q="Do I need an account to look?">
            No. Browsing is open — an account is for booking, because a booking takes a card and a
            name.
          </QA>
          <QA q="What does it cost?">
            The figure on the listing, and nothing else. The host&rsquo;s rate plus a{" "}
            {FEE_PERCENT}% service fee, already included in what you see. A slot starting within
            two hours adds {formatCents(INSTANT_FEE_CENTS)}. It is all set out on{" "}
            <Inline href="/pricing">the pricing page</Inline>.
          </QA>
          <QA q="How do I get in?">
            The entry instructions and the door code appear {CANCEL_HOURS} hours before your
            session, in the app, for a booking that is paid for. Most rooms are a keypad or a
            lockbox; some hosts let you in themselves, and the listing says which.
          </QA>
          <QA q="Can I book the same hour every week?">
            Yes — you can book a run of weeks at once, in the same room at the same hour. It is
            the thing this is built for rather than a feature bolted on.
          </QA>
          <QA q="How far ahead can I book?">
            {BOOKING_HORIZON_DAYS} days, or {PRO_BOOKING_HORIZON_DAYS} with Pro. Fourteen shows
            every slot in a weekly cycle twice over; thirty is room to plan a term.
          </QA>
          <QA q="What if I have to cancel?">
            More than {CANCEL_HOURS} hours ahead and the charge is voided — nothing reaches your
            statement. Inside that window it stands, because the host held the hour open.
          </QA>
          <QA q="Can I bring my own clients?">
            That is the entire idea. You book the room; who you see in it and how you work is
            yours.
          </QA>
        </dl>
      </Section>

      <Section title="Letting a room">
        <dl className="space-y-6">
          <QA q="What do you take?">
            Nothing from your rate. The {FEE_PERCENT}% is added on top and the practitioner pays
            it, so what you set is what reaches your bank. Listing is free and there is no monthly
            charge.
          </QA>
          <QA q="When am I paid?">
            After each session, to your bank through Stripe. Not on booking — the money is held
            until the hour has actually happened.
          </QA>
          <QA q="Who decides the hours?">
            You do, and nothing outside them is bookable. A room closed before nine simply cannot
            be booked before nine.
          </QA>
          <QA q="What do I have to provide?">
            Photographs, the address, your rate, your hours, and a lease or ownership document
            showing you may let the room. About ten minutes. We check the listing and the document
            before it goes live — usually a day.
          </QA>
          <QA q="Do I have to be there?">
            No. Most hosts use a keypad or a lockbox and the code goes only to somebody who has
            paid. If you would rather let people in yourself, set the room to that and it is only
            bookable when you can.
          </QA>
          <QA q="What if something is damaged?">
            You can raise a claim for 48 hours after a session and we hold that payout while it is
            open. Every practitioner confirms they carry their own insurance —{" "}
            <Inline href="/trust">trust &amp; safety</Inline> sets out the whole of it.
          </QA>
          <QA q="What could my room earn?">
            Put your own rate and free hours into{" "}
            <Inline href="/rent-out-your">the calculator</Inline> and it will tell you, using your
            numbers rather than an average of somebody else&rsquo;s.
          </QA>
        </dl>
      </Section>

      <Section title="Still stuck">
        <p>
          Write to us. There is no queue and no ticket number —{" "}
          <Inline href="/contact">contact</Inline> has the address and what is worth putting in the
          message.
        </p>
        <p>
          {BRAND} is a booking platform: it does not own the rooms, and provides no medical or
          health service. The full terms are{" "}
          <Inline href={`${APP_URL}/terms`}>in the app</Inline>, where they are agreed to.
        </p>
      </Section>
    </PageShell>
  );
}
