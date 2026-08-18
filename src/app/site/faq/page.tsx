import Link from "next/link";
import type { Metadata } from "next";

import { PageShell, QA, Section } from "@/components/site/page-shell";
import { APP_URL, BRAND, WEBSITE } from "@/lib/company";
import {
  BOOKING_HORIZON_DAYS,
  FREE_CANCEL_WINDOW_MS,
  INSTANT_FEE_CENTS,
  PRO_BOOKING_HORIZON_DAYS,
  formatCents,
} from "@/lib/money";
import { COLOUR } from "@/lib/site-theme";

/**
 * Split by side, because nobody arrives with a general interest in the
 * marketplace. They arrive as one of two people with about six questions.
 *
 * Numbers come from lib/money, so this cannot drift from what the app charges.
 */

export const metadata: Metadata = {
  title: "Questions",
  description:
    "How booking a room works, what it costs, how you get in, and how listing your " +
    "own space works.",
  alternates: { canonical: `${WEBSITE}/faq` },
};

const CANCEL_HOURS = FREE_CANCEL_WINDOW_MS / 3_600_000;

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
      title={<>Everything you might ask.</>}
      standfirst="Booking a room comes first, letting one comes second. Most people only need one half."
    >
      <Section title="Booking a room">
        <dl className="space-y-6">
          <QA q="Do I need an account to look?">No. You only need one to book.</QA>

          <QA q="What does it cost?">
            The price on the listing, and nothing more. Nothing is added at checkout. Booking
            something starting within two hours adds {formatCents(INSTANT_FEE_CENTS)}. Full detail
            on <Inline href="/pricing">pricing</Inline>.
          </QA>

          <QA q="How do I get in?">
            Everything you need to enter appears in the app shortly before your session. The
            listing tells you what kind of entry the room has.
          </QA>

          <QA q="Can I book the same hour every week?">
            Yes. Book several weeks at once, same room and same time — ideal if your clients come
            to you regularly.
          </QA>

          <QA q="How far ahead can I book?">
            {BOOKING_HORIZON_DAYS} days, or {PRO_BOOKING_HORIZON_DAYS} days with Pro.
          </QA>

          <QA q="What if I need to cancel?">
            Cancel {CANCEL_HOURS} hours or more ahead and you are refunded, apart from the card
            processing fee. Inside that window the booking stands, because the host kept the hour
            free for you.
          </QA>

          <QA q="Can I bring my own clients?">
            Yes. The room is yours for the hour — your clients, your practice, your way of working.
          </QA>
        </dl>
      </Section>

      <Section title="Listing your space">
        <dl className="space-y-6">
          <QA q="What do you take?">
            Nothing from your rate. What you set is what you receive, and listing is free.
          </QA>

          <QA q="When am I paid?">
            After each session, straight to your bank through Stripe.
          </QA>

          <QA q="Who decides the hours?">
            You do. Nothing outside the hours you choose can be booked.
          </QA>

          <QA q="What do I need to list?">
            Photographs, the address, your rate, your hours, and a document showing you can let the
            room. About ten minutes. We review it before it goes live, usually within a day.
          </QA>

          <QA q="Do I have to be there?">
            Only if you want to be. If you would rather let people in yourself, set the room up
            that way and it can only be booked when you are free.
          </QA>

          <QA q="What if something gets damaged?">
            You have 48 hours after a session to tell us, and we hold that payout while we look
            into it. Every practitioner carries their own insurance. More on{" "}
            <Inline href="/trust">trust &amp; safety</Inline>.
          </QA>

          <QA q="What could my room earn?">
            Put your rate and your free hours into{" "}
            <Inline href="/rent-out-your">the calculator</Inline> and see.
          </QA>
        </dl>
      </Section>

      <Section title="Still need help?">
        <p>
          Write to us — <Inline href="/contact">contact</Inline> has the address and what to
          include.
        </p>
        <p>
          {BRAND} does not own the rooms and provides no medical or health service. Full terms are{" "}
          <Inline href={`${APP_URL}/terms`}>in the app</Inline>.
        </p>
      </Section>
    </PageShell>
  );
}
