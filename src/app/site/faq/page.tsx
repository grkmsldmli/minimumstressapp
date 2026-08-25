import type { Metadata } from "next";

import { Onward, PageShell, QA, Section } from "@/components/site/page-shell";
import { BRAND, SUPPORT_EMAIL, WEBSITE } from "@/lib/company";
import { PROHIBITED_USES } from "@/lib/booking-use";

/**
 * Three groups, with the answers closed until somebody asks one.
 *
 * The old page was written for the marketplace we thought we had. It answered
 * as though every guest were a practitioner, quoted the service fee as a
 * percentage twice, priced the Pro subscription, explained the last-minute
 * charge and linked to a pricing page that spelled out the whole model. All of
 * that is money at the wrong moment: somebody reading the FAQ has not decided
 * to book anything, and those numbers belong on the slot, at checkout, and at
 * the limit Pro lifts — where they change a decision instead of describing a
 * business.
 *
 * What is left is what the page is for. What a space may be used for, who
 * decides, how you get in, and what happens when something goes wrong.
 *
 * Three answers say less than the brief for them wanted, because the fuller
 * version would have described things the app does not do. Each is marked
 * where it appears.
 */

export const metadata: Metadata = {
  title: "Questions",
  description:
    "How booking a space works, what you can use one for, how to list your own, " +
    "and the rules that apply to both sides.",
  alternates: { canonical: `${WEBSITE}/faq` },
};

export default function FaqPage() {
  return (
    <PageShell
      eyebrow="FAQ"
      title={<>Questions, answered.</>}
      standfirst="The basics about booking a space, listing one, and what happens in between."
    >
      <Section title="Booking a space">
        <dl>
          <QA q="Do I need an account to browse?">
            No. You can explore spaces without an account. You will need one when you are ready to
            book.
          </QA>

          <QA q="What can I book a space for?">
            That depends on the space and what the host allows. Uses may include private client
            sessions, yoga, Pilates and movement, meditation and breathwork, coaching and
            consultation, small group classes, and workshops.
            <br />
            <br />
            You say what you plan to use the space for before you book.
          </QA>

          {/*
            "Book the amount of time you need" is what the brief asked for, and
            the booking form cannot do it: SESSION_MINUTES is 60 and a session
            is one hour. Somebody would have found that out at the moment they
            tried, which is the worst place to learn it.

            Recurring is real, but it is not a property of the space — booking
            more than one week at a time is what Pro lifts. Said the way it
            works rather than the way it reads better.
          */}
          <QA q="How long is a booking?">
            One hour. Take the slots next to each other when you need longer.
            <br />
            <br />
            You can also book the same time each week for a run of weeks, which is part of Pro.
          </QA>

          <QA q="Can I bring clients or participants?">
            Yes, where the space allows it. Your booking has to stay within the listed capacity and
            the use you declared when you booked.
          </QA>

          {/*
            This answer was once "we do not require it and we do not check it".
            That is no longer true, and saying it would now be the invention:
            the booking gate refuses a professional booking without verified
            liability cover that is valid on the session date (lib/insurance.ts,
            enforced server-side in booking-plan.ts). The copy only says a
            booking needs it because the gate actually enforces it — the safeguard
            exists before the sentence claims it does.
          */}
          <QA q="Do I need insurance?">
            To confirm a booking as a professional, yes: you need liability cover on file that we
            verify — active and valid for your session date. You can browse spaces without it, and
            add or update your certificate any time from your profile. Your cover, your
            qualifications and your clients remain your own responsibility.
          </QA>

          <QA q="How do I get into the space?">
            Every listing explains how access works, and the entry details reach you for a
            confirmed booking at the right time.
            <br />
            <br />
            Some spaces use a keypad or a lockbox; at others the host meets you.
          </QA>

          <QA q="What will I find in the room?">
            Each listing shows its setup, capacity, amenities, access details and what is included.
            Read it before booking, so you know what is there and what to bring.
          </QA>

          <QA q="Can I cancel?">
            Yes. The cancellation terms are shown before you confirm the booking.
          </QA>
        </dl>
      </Section>

      <Section title="Listing a space">
        <dl>
          <QA q="What kinds of spaces can I list?">
            Movement studios, consultation and coaching rooms, holistic practice rooms, meditation
            and breathwork spaces, and other suitable wellness spaces.
          </QA>

          <QA q="Who decides what my space can be used for?">
            You do, within the {BRAND} rules that apply to every space. You choose the activities
            you allow, your capacity, your available times and your house rules.
          </QA>

          <QA q="Can I approve bookings myself?">
            Yes. You choose how bookings reach you when you list. Where you have asked to approve
            them, you see the declared use and the booking details before you accept.
          </QA>

          <QA q="Who decides my availability?">
            You do. Only the times you make available can be booked.
          </QA>

          <QA q="Who sets the price?">
            You set your own rate, and what you receive is shown while you are setting it.
          </QA>

          <QA q="Do I need to be there?">
            Not necessarily. You decide how guests get in, and provide the access instructions for
            confirmed bookings.
          </QA>

          <QA q="What if someone uses my space for something I did not allow?">
            Everybody declares what they are booking for, and agrees to follow the rules of the
            space and of {BRAND}. Misrepresenting the purpose of a booking, or using a space for a
            prohibited activity, can end the booking and restrict the account.
          </QA>

          <QA q="What if something is damaged?">
            Report it through {BRAND} as soon as you can after the booking. The claim process and
            its deadlines are explained in the app and in the terms.
          </QA>
        </dl>
      </Section>

      <Section title="Safety and permitted use">
        <dl>
          <QA q="Are all activities allowed?">
            No. {BRAND} does not permit illegal activity, sexual services, adult-content
            production, parties, or other prohibited or unsafe uses. Hosts may add rules of their
            own on top of that.
            {/*
              Read from the same list the booking rules and the terms use, so
              this page cannot end up describing something different from what
              is actually enforced.
            */}
            <br />
            <br />
            <span style={{ opacity: 0.85 }}>{PROHIBITED_USES.slice(0, 4).join(" · ")}</span>
          </QA>

          <QA q={`Does ${BRAND} certify professionals?`}>
            No. {BRAND} provides the marketplace and the booking infrastructure. Anybody working
            professionally stays responsible for their own qualifications, licences, insurance and
            anything else that applies to their work.
          </QA>

          <QA q={`Does ${BRAND} own the spaces?`}>
            No. Spaces are offered by independent hosts. {BRAND} provides the platform that helps
            people find, book and get into them.
          </QA>
        </dl>
      </Section>

      <Section title="Still have a question?">
        <p>
          Write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>{" "}
          and we will help you figure it out.
        </p>

        <Onward href="/spaces">Find a space</Onward>
      </Section>
    </PageShell>
  );
}
