import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Reveal } from "@/components/site/reveal";
import { BRAND, WEBSITE } from "@/lib/company";
import { CLAIM_WINDOW_HOURS } from "@/lib/claims";
import { FREE_CANCEL_WINDOW_MS } from "@/lib/money";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * Not "we are safe" — how, and where it stops.
 *
 * This was a page of paragraphs and the content was right: verification before
 * listing, access tied to a paid booking, a claim window, cancellation,
 * reviews in both directions. What it did badly was make somebody read an
 * essay to find the one answer they came for — and the two people who arrive
 * here arrive with opposite questions. A host is asking who is coming into
 * their room. A practitioner is asking whether the room exists and what
 * happens to their money.
 *
 * So it is laid out as answers rather than as prose, split by which of the two
 * you are. The section that matters most is the one saying what we do not
 * check: a platform that leaves that vague is one somebody will later say
 * implied more than it promised.
 *
 * The questions are `details` elements rather than an accordion with state.
 * They open with no JavaScript, the browser's own find-in-page reaches the
 * closed answers, and a crawler reads all of them.
 */

export const metadata: Metadata = {
  title: "Trust & Safety",
  description:
    "What we check before a room is listed, who can get in and when, what happens if something " +
    "goes wrong, and what we do not certify.",
  alternates: { canonical: `${WEBSITE}/trust` },
};

const CANCEL_HOURS = FREE_CANCEL_WINDOW_MS / 3_600_000;

const PILLARS = [
  {
    title: "Space verification",
    body: "We review the listing and the host's right to offer the space before it goes live.",
  },
  {
    title: "Controlled access",
    body: "Entry details are released only for a booking that is paid for and still standing.",
  },
  {
    title: "Booking accountability",
    body: "Both sides know who booked, when the space is in use, and what was agreed.",
  },
  {
    title: "Two-way reviews",
    body: "Practitioners review spaces. Hosts review bookings. Neither can answer the other.",
  },
];

const SIDES = [
  {
    who: "If you are booking a space",
    heading: "Before you arrive",
    points: [
      "The address is on the listing, before you pay",
      "What is in the room, and anything to bring",
      "Entry details released as your session approaches",
      "Cancellation terms shown before you confirm",
    ],
  },
  {
    who: "If you are listing a space",
    heading: "Before anyone arrives",
    points: [
      "You know who booked, and can message them",
      "The booking is paid before it stands",
      "They carry liability cover we verify before they can book",
      "Access exists only for that booking",
    ],
  },
];

const WHEN_WRONG = [
  {
    title: "Damage",
    body: `Report it within ${CLAIM_WINDOW_HOURS} hours of the session. We hold that payout while the report is open.`,
  },
  {
    title: "A host cancels",
    body: "The practitioner is refunded in full and access is removed, whenever it happens.",
  },
  {
    title: "Not as described",
    body: "Tell us and say so in your review, so the listing can be looked at.",
  },
];

const VERIFY = [
  "Listing information",
  "The right to offer the space",
  "A professional's liability cover, before they can book",
  "Booking and payment status",
  "Access tied to the booking",
];

const DO_NOT = [
  "Practitioner qualifications",
  "Professional licences",
  "The services a practitioner provides",
];

const FAQ = [
  {
    q: "Who is coming into my space?",
    a: "Someone with an account who has accepted the terms, said what they are booking for, and paid. You see who booked and can message them beforehand.",
  },
  {
    q: "What if they do not turn up?",
    a: "They are still charged. Payment is taken when the booking is made, not on the day.",
  },
  {
    q: "What if the room is not as described?",
    a: "Tell us, and say so in your review. A listing that misdescribes a room is a listing problem, and the review is the part that reaches the next person.",
  },
  {
    q: "Can I cancel?",
    a: `Cancel more than ${CANCEL_HOURS} hours before the session and you are refunded. Inside that window the booking stands, because the host held the hour for you.`,
  },
];

export default function TrustPage() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-12 pt-6">
          <div className="max-w-3xl">
            <p className={TYPE.eyebrow} style={{ color: COLOUR.link }}>
              Trust &amp; safety
            </p>
            <h1
              className={`mt-4 ${TYPE.h2}`}
              style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
            >
              Know the space. Know the booking.
              <br />
              Know what happens next.
            </h1>
            <p className={`mt-6 ${TYPE.lead}`} style={{ color: COLOUR.body }}>
              Documented listings, access tied to a paid booking, and accountability on both sides.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="grid gap-4 sm:grid-cols-2">
            {PILLARS.map((pillar, index) => (
              <Reveal key={pillar.title} delay={index * 80}>
                <div
                  className="h-full rounded-2xl p-7"
                  style={{ border: `1px solid ${COLOUR.line}`, backgroundColor: COLOUR.wash }}
                >
                  <h2 className="text-[19px] font-medium" style={{ color: COLOUR.ink }}>
                    {pillar.title}
                  </h2>
                  <p className={`mt-2.5 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                    {pillar.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="border-y py-16" style={{ borderColor: COLOUR.line }}>
          <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:gap-16">
            {SIDES.map((side, index) => (
              <Reveal key={side.who} delay={index * 100}>
                <div>
                  <p className={TYPE.eyebrow} style={{ color: COLOUR.link }}>
                    {side.who}
                  </p>
                  <h2
                    className="mt-3 text-[24px]"
                    style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
                  >
                    {side.heading}
                  </h2>
                  <ul className="mt-5 space-y-3">
                    {side.points.map((point) => (
                      <li
                        key={point}
                        className={`flex gap-3.5 ${TYPE.body}`}
                        style={{ color: COLOUR.body }}
                      >
                        <span
                          aria-hidden
                          className="mt-2 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: COLOUR.accent }}
                        />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            <h2
              className={TYPE.h2}
              style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
            >
              If something goes wrong.
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {WHEN_WRONG.map((item, index) => (
              <Reveal key={item.title} delay={index * 80}>
                <div
                  className="h-full rounded-2xl p-6"
                  style={{ border: `1px solid ${COLOUR.line}` }}
                >
                  <h3 className="text-[17px] font-medium" style={{ color: COLOUR.ink }}>
                    {item.title}
                  </h3>
                  <p className={`mt-2 ${TYPE.small}`} style={{ color: COLOUR.body }}>
                    {item.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section
          className="border-y py-16"
          style={{ borderColor: COLOUR.line, backgroundColor: COLOUR.wash }}
        >
          <div className="mx-auto max-w-6xl px-6">
            <Reveal>
              <h2
                className={TYPE.h2}
                style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
              >
                What we check, and what we do not.
              </h2>
            </Reveal>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <Reveal>
                <div
                  className="h-full rounded-2xl bg-white p-7"
                  style={{ border: `1px solid ${COLOUR.line}` }}
                >
                  <h3 className="text-[17px] font-medium" style={{ color: COLOUR.ink }}>
                    We check
                  </h3>
                  <ul className="mt-4 space-y-2.5">
                    {VERIFY.map((item) => (
                      <li key={item} className={TYPE.body} style={{ color: COLOUR.body }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>

              <Reveal delay={100}>
                <div
                  className="h-full rounded-2xl bg-white p-7"
                  style={{ border: `1px solid ${COLOUR.line}` }}
                >
                  <h3 className="text-[17px] font-medium" style={{ color: COLOUR.ink }}>
                    We do not certify
                  </h3>
                  <ul className="mt-4 space-y-2.5">
                    {DO_NOT.map((item) => (
                      <li key={item} className={TYPE.body} style={{ color: COLOUR.muted }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-5 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
                    Each professional is responsible for holding whatever their work requires, and
                    for their own clients. {BRAND} does not own the rooms listed and provides no
                    medical or health service.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="max-w-3xl">
            <h2
              className={TYPE.h2}
              style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
            >
              Common questions.
            </h2>

            <div className="mt-8">
              {FAQ.map((item) => (
                <details key={item.q} className="border-b py-5" style={{ borderColor: COLOUR.line }}>
                  <summary
                    className={`cursor-pointer font-medium ${TYPE.body}`}
                    style={{ color: COLOUR.ink }}
                  >
                    {item.q}
                  </summary>
                  <p className={`mt-3 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <Reveal>
          <section className="py-20 text-white" style={{ backgroundColor: COLOUR.dark }}>
            <div className="mx-auto max-w-6xl px-6">
              <h2 className={TYPE.h2} style={{ fontFamily: "var(--font-dm-serif)" }}>
                Space should feel straightforward
                <br />
                on both sides.
              </h2>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/spaces"
                  className="rounded-full bg-white px-8 py-4 text-[16px] font-medium transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ color: COLOUR.ink }}
                >
                  Find a space
                </Link>
                <Link
                  href="/rent-out-your"
                  className="rounded-full border px-8 py-4 text-[16px] font-medium text-white"
                  style={{ borderColor: "rgba(255,255,255,.35)" }}
                >
                  List your space
                </Link>
              </div>
            </div>
          </section>
        </Reveal>
      </main>

      <SiteFooter />
    </>
  );
}
