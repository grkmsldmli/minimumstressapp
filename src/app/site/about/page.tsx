import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Reveal } from "@/components/site/reveal";
import { APP_URL, LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";
import { CATEGORIES } from "@/lib/taxonomy";

/**
 * Who this is, and what it does — in that order, and mostly the second.
 *
 * It was five paragraphs and a box, and the paragraphs were good. What it
 * lacked was the shape of the thing being described: a marketplace has two
 * sides, and a page about one that never puts them beside each other leaves
 * the reader to assemble that themselves.
 *
 * The heading stays. "Wellness work needs space" is the whole argument in four
 * words and nothing here improves on it.
 *
 * One passage was replaced rather than trimmed. "We are not a clinic. We are
 * not trying to be the wellness brand in the room." is true, and it is three
 * sentences of what we are not before anything about what we are. What
 * replaces it says the same thing forwards — and keeps the one disclaimer that
 * has to be stated outright rather than implied, which is that practitioners
 * here operate independently and we do not provide their service.
 *
 * The title is the one thing deliberately not taken as given. The proposed one
 * was "Private Wellness Space by the Hour | Minimum Stress | Book Now", which
 * is already the app's own title at minimumstress.app. Two pages we own,
 * competing for one phrase, means a search engine picks one and buries the
 * other — and the one it buries would probably be the app, which is the thing
 * that takes bookings.
 */

export const metadata: Metadata = {
  title: "About",
  description:
    "Minimum Stress connects independent wellness professionals with private spaces they can " +
    "book by the hour, and helps hosts earn from space that would otherwise sit unused.",
};

/** What each side gets: a claim, then the sentence that earns it. */
const SIDES = [
  {
    who: "For practitioners",
    claim: "Work independently without carrying a full-time space.",
    body:
      "A professional setting should not require a monthly lease. Book a private room or a " +
      "studio for the hours you actually use, and bring your own clients to it.",
    href: "/spaces",
    action: "Find a space",
  },
  {
    who: "For hosts",
    claim: "Empty hours can become useful hours.",
    body:
      "Studios, offices and treatment rooms sit unused for much of the week while somebody is " +
      "still paying for them. You set the hours and the rate, and you keep the rate.",
    href: "/rent-out-your",
    action: "See what it could earn",
  },
];

const FLOWS = [
  { who: "Booking a space", steps: ["Find", "Book", "Work"] },
  { who: "Letting one", steps: ["List", "Set your hours", "Get booked"] },
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-14 pt-6">
          <div className="max-w-3xl">
            <h1
              className={TYPE.hero}
              style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
            >
              Wellness work
              <br />
              <em className="italic" style={{ color: COLOUR.accent }}>
                needs space.
              </em>
            </h1>

            <p className={`mt-7 ${TYPE.lead}`} style={{ color: COLOUR.body }}>
              Minimum Stress connects independent wellness professionals with private spaces they
              can book by the hour — and helps the people who own those spaces earn from hours
              that would otherwise sit unused.
            </p>

            <p className={`mt-4 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
              No lease. No long-term commitment. The space you need, for the hours you need it.
            </p>
          </div>
        </section>

        {/*
          The picture breaks the wall of text, and it is the argument rather
          than decoration: somebody letting themselves into a room that is
          theirs for the next hour.
        */}
        <Reveal>
          <div className="mx-auto max-w-6xl px-6">
            <div
              className="overflow-hidden rounded-3xl"
              style={{ border: `1px solid ${COLOUR.line}` }}
            >
              <Image
                src="/photos/moment-arriving.webp"
                alt="A practitioner with a mat over her shoulder opening a keypad door onto a studio."
                width={1672}
                height={941}
                priority
                sizes="(min-width: 1152px) 72rem, 100vw"
                className="aspect-[21/9] h-full w-full object-cover"
              />
            </div>
          </div>
        </Reveal>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2
              className={TYPE.h2}
              style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
            >
              Why we exist.
            </h2>
          </Reveal>

          <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-14">
            {SIDES.map((side, index) => (
              <Reveal key={side.who} delay={index * 110}>
                <div>
                  <p className={TYPE.eyebrow} style={{ color: COLOUR.link }}>
                    {side.who}
                  </p>
                  <h3 className={`mt-3 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                    {side.claim}
                  </h3>
                  <p className={`mt-3 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                    {side.body}
                  </p>
                  <Link
                    href={side.href}
                    className={`mt-4 inline-block underline underline-offset-4 ${TYPE.body}`}
                    style={{ color: COLOUR.link }}
                  >
                    {side.action} →
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section
          className="border-y py-20"
          style={{ borderColor: COLOUR.line, backgroundColor: COLOUR.wash }}
        >
          <div className="mx-auto max-w-6xl px-6">
            <Reveal>
              <div className="max-w-3xl">
                <h2
                  className={TYPE.h2}
                  style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
                >
                  We provide the space between the two sides.
                </h2>
                <p className={`mt-5 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                  Practitioners bring their work and their clients. Hosts provide the room. Minimum
                  Stress handles discovery, booking, scheduling, payment and the access details, so
                  both sides can get on with the part that is theirs.
                </p>
                <p className={`mt-4 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
                  Minimum Stress does not provide practitioner services. Every professional here
                  works independently and is responsible for their own practice.
                </p>
              </div>
            </Reveal>

            <div className="mt-12 grid gap-10 sm:grid-cols-2">
              {FLOWS.map((flow, index) => (
                <Reveal key={flow.who} delay={index * 110}>
                  <div>
                    <p className={TYPE.eyebrow} style={{ color: COLOUR.muted }}>
                      {flow.who}
                    </p>
                    <ol className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                      {flow.steps.map((step, position) => (
                        <li key={step} className={`flex items-center gap-3 ${TYPE.body}`}>
                          <span style={{ color: COLOUR.ink }}>{step}</span>
                          {position < flow.steps.length - 1 && (
                            <span aria-hidden style={{ color: COLOUR.accent }}>
                              →
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/*
          The four, read from lib/taxonomy rather than written out again here.
          This page and the app describing the same rooms in different words is
          how a reader learns the site does not know itself.
        */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2
              className={TYPE.h2}
              style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
            >
              Built for independent wellness work.
            </h2>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {CATEGORIES.map((category, index) => (
              <Reveal key={category.key} delay={index * 90}>
                <div
                  className="h-full overflow-hidden rounded-2xl"
                  style={{ border: `1px solid ${COLOUR.line}` }}
                >
                  {/* The gradient has been in the taxonomy since the beginning
                      and never reached a page, which is why four kinds of room
                      have always read as four identical grey boxes. */}
                  <div
                    className="h-1.5"
                    style={{
                      background: `linear-gradient(90deg, ${category.gradient[0]}, ${category.gradient[1]})`,
                    }}
                  />
                  <div className="p-6">
                    <h3 className={TYPE.h3} style={{ color: COLOUR.ink }}>
                      {category.label}
                    </h3>
                    <p className={`mt-2 ${TYPE.small}`} style={{ color: COLOUR.body }}>
                      {category.specialties.join(" · ")}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <Reveal>
          <section className="py-20 text-white" style={{ backgroundColor: COLOUR.dark }}>
            <div className="mx-auto max-w-6xl px-6">
              <h2 className={TYPE.h2} style={{ fontFamily: "var(--font-dm-serif)" }}>
                There is already space.
                <br />
                It just needs to be shared.
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

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div
            className="rounded-2xl p-7"
            style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
          >
            <p className={TYPE.body} style={{ color: COLOUR.body }}>
              Minimum Stress is operated by{" "}
              <strong style={{ color: COLOUR.ink }}>{LEGAL_ENTITY}</strong>, California.
            </p>
            <p className={`mt-2 ${TYPE.body}`} style={{ color: COLOUR.body }}>
              If something needs a person, write to{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="underline underline-offset-4"
                style={{ color: COLOUR.link }}
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>

            <nav className={`mt-5 flex flex-wrap gap-6 ${TYPE.small}`}>
              <a
                href={`${APP_URL}/terms`}
                className="hover:underline"
                style={{ color: COLOUR.muted }}
              >
                Terms
              </a>
              <a
                href={`${APP_URL}/privacy`}
                className="hover:underline"
                style={{ color: COLOUR.muted }}
              >
                Privacy
              </a>
              <Link href="/trust" className="hover:underline" style={{ color: COLOUR.muted }}>
                Trust &amp; safety
              </Link>
            </nav>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
