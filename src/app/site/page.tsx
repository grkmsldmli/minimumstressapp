import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Reveal } from "@/components/site/reveal";
import { SpaceCarousel, type Slide } from "@/components/site/space-carousel";
import { SpaceSearch } from "@/components/site/space-search";
import { APP_URL, BRAND } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * A marketplace homepage that is also legible.
 *
 * Two rounds got it here. The first made it a marketplace: the search moved to
 * the top, and everything under it answers a question somebody has after
 * seeing it. This round is about whether any of it can be read.
 *
 * It could not, and the reason was measurable rather than aesthetic. Secondary
 * text sat at 3.07:1 against white and every link at 2.77:1, where AA asks for
 * 4.5 — a fault invisible to the only test anybody was applying, which was
 * looking at it on a good screen. Body text ran at 15px, headings at 26 to 32,
 * and the whole page lived in that narrow band with nothing large enough to be
 * a landmark. Everything was a white box with a pale outline, fifteen times
 * over, on white.
 *
 * So: the palette from lib/site-theme, with its contrast pinned by a test.
 * Body text at 17px and a hero at 62. Section grounds that alternate, and one
 * that is dark, so scrolling has a rhythm instead of a single flat column. The
 * four category cards carry the gradients already defined in lib/taxonomy and
 * never used out here. And each section lifts into view as you reach it —
 * after mount, never in the markup, so nothing is hidden from a reader whose
 * JavaScript did not run, and not at all for anybody who asked for less
 * motion.
 *
 * Still not here: a strip of real listings. There are none. A row of invented
 * rooms is checkable in one click by exactly the person we need.
 */

export const metadata: Metadata = {
  title: "Wellness Spaces for Rent by the Hour",
  description:
    "Treatment rooms, Pilates studios, private consulting rooms and movement space, rented " +
    "by the hour. No lease, no deposit — or list the space you already have.",
};

const HERO: Slide[] = [
  {
    src: "/photos/room-treatment.webp",
    label: "Treatment room",
    alt: "A treatment room with a made table and a window onto trees.",
  },
  {
    src: "/photos/moment-arriving.webp",
    label: "Let yourself in",
    alt: "A practitioner with a mat over her shoulder opening a keypad door onto a pilates studio.",
  },
  {
    src: "/photos/room-studio.webp",
    label: "Movement studio",
    alt: "A movement studio with mats, bolsters and a mirror.",
  },
  {
    src: "/photos/moment-booking.webp",
    label: "Book the hour",
    alt: "A practitioner checking her phone beside a made treatment table.",
  },
  {
    src: "/photos/room-consulting.webp",
    label: "Consulting space",
    alt: "A consulting room with two wooden-framed chairs facing each other over a low table.",
  },
  {
    src: "/photos/room-open-plan.webp",
    label: "Open space",
    alt: "An open room with a treatment table at one end and a mat at the other.",
  },
];

/**
 * The four groups, carrying the gradients from lib/taxonomy.
 *
 * Those were written for the app's cards and map pins and had never appeared
 * on this side, which is why the site read as grey: the brand had colour and
 * the marketing pages were not using any of it.
 */
const GROUPS = [
  {
    title: "Private rooms",
    body: "For consultations, coaching and seeing one person at a time.",
    type: "consultation-room",
    gradient: ["#7FB4E8", "#1C2B4E"],
  },
  {
    title: "Treatment rooms",
    body: "A couch, a sink and a door that locks — for hands-on work.",
    type: "treatment-room",
    gradient: ["#5FA876", "#12332A"],
  },
  {
    title: "Pilates & movement",
    body: "Reformers, mirrors and floor enough to work on.",
    type: "pilates-studio",
    gradient: ["#3B9BE8", "#16304E"],
  },
  {
    title: "Yoga & meditation",
    body: "Quiet rooms for classes and for sitting.",
    type: "yoga-studio",
    gradient: ["#8E7FE8", "#241C4E"],
  },
] as const;

const STEPS = [
  { n: "1", title: "Search", body: "The kind of room you need, in the town you work in." },
  { n: "2", title: "Book", body: "Pick the hours. You pay the price on the listing, and nothing else." },
  { n: "3", title: "Work", body: "Let yourself in with the code, and see your own clients." },
];

const TRUST = [
  {
    title: "The whole price, up front",
    body: "The figure on the listing is the figure you pay. No booking fee revealed at checkout.",
  },
  {
    title: "Only the hours you need",
    body: "An hour is an hour. There is no minimum term and nothing to sign.",
  },
  {
    title: "Checked before it is listed",
    body: "We look at the listing and the lease or ownership document before a room goes live.",
  },
  {
    title: "Cancel a day ahead",
    body: "Cancel 24 hours before and the money comes back. Said plainly, on the listing.",
  },
];

export default function SiteHome() {
  return (
    <>
      <SiteHeader />

      <main>
        <Hero />
        <Groups />
        <HowItWorks />
        <ForPractitioners />
        <ForHosts />
        <Recurring />
        <Trust />
        <Install />
      </main>

      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className={TYPE.eyebrow} style={{ color: COLOUR.link }}>
      {children}
    </p>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-6 lg:grid-cols-[1fr_1.05fr] lg:pb-24">
      <div>
        <h1
          className={TYPE.hero}
          style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
        >
          Wellness spaces,
          <br />
          <em className="italic" style={{ color: COLOUR.accent }}>
            by the hour.
          </em>
        </h1>

        <p className={`mt-6 max-w-lg ${TYPE.lead}`} style={{ color: COLOUR.body }}>
          Treatment rooms, Pilates studios, private consulting rooms and movement space — for the
          hours you need and not a month more. No lease. No deposit.
        </p>

        <SpaceSearch />

        <p className={`mt-5 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
          Have a space?{" "}
          <Link href="/rent-out-your" className="underline underline-offset-2" style={{ color: COLOUR.link }}>
            See what it could earn
          </Link>
        </p>
      </div>

      <SpaceCarousel slides={HERO} />
    </section>
  );
}

function Groups() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-20">
      <Reveal>
        <h2 className={TYPE.h2} style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}>
          Explore by space
        </h2>
      </Reveal>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GROUPS.map((group, index) => (
          <Reveal key={group.type} delay={index * 70}>
            <Link
              href={`/spaces?type=${group.type}`}
              className="group block h-full overflow-hidden rounded-2xl transition-transform duration-300 hover:-translate-y-1"
              style={{ border: `1px solid ${COLOUR.line}` }}
            >
              {/*
                A band of the room type's own colour. It is the difference
                between four outlined boxes and four things you can tell apart
                at a glance — and the gradients already existed, for the cards
                inside the app.
              */}
              <span
                className="block h-2 w-full"
                style={{
                  background: `linear-gradient(90deg, ${group.gradient[0]}, ${group.gradient[1]})`,
                }}
              />
              <span className="block p-5">
                <span className={`block ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                  {group.title}
                </span>
                <span className={`mt-2 block ${TYPE.small}`} style={{ color: COLOUR.muted }}>
                  {group.body}
                </span>
                <span
                  className="mt-4 block text-[15px] font-medium transition-transform duration-300 group-hover:translate-x-1"
                  style={{ color: COLOUR.link }}
                >
                  Explore spaces →
                </span>
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-y py-20" style={{ borderColor: COLOUR.line, backgroundColor: COLOUR.wash }}>
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <h2 className={TYPE.h2} style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}>
            Space when you need it.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-10 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delay={index * 90}>
              <span
                className="flex h-11 w-11 items-center justify-center rounded-full text-[17px] font-medium text-white"
                style={{ backgroundColor: COLOUR.accent }}
              >
                {step.n}
              </span>
              <h3 className={`mt-4 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                {step.title}
              </h3>
              <p className={`mt-2 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                {step.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForPractitioners() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <div className="max-w-2xl">
          <Eyebrow>If you need a space</Eyebrow>
          <h2
            className={`mt-4 ${TYPE.h2}`}
            style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
          >
            A professional room,
            <br />
            without the lease.
          </h2>
          <p className={`mt-5 ${TYPE.body}`} style={{ color: COLOUR.body }}>
            Work for yourself without signing for a studio you use six hours a week. Book the hour,
            pay the price you were shown, and let yourself in — the door code arrives the day
            before.
          </p>

          <ul className="mt-7 space-y-3">
            {[
              "Book by the hour, or the same hour every week",
              "Choose the town you actually work in",
              "See your own clients, in your own way",
              "Cancel 24 hours ahead and the money comes back",
            ].map((line) => (
              <li key={line} className={`flex gap-3.5 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                <span
                  className="mt-2.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: COLOUR.accent }}
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/spaces"
            className="mt-8 inline-block rounded-full px-8 py-4 text-[16px] font-medium text-white transition-transform duration-200 hover:-translate-y-0.5"
            style={{ backgroundColor: COLOUR.ink }}
          >
            Find a space
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/**
 * The host section, on the dark ground.
 *
 * It is the half of the marketplace that is short, so it gets the one section
 * on the page that looks different from every other — the reader is meant to
 * notice they have arrived somewhere addressed to them.
 */
function ForHosts() {
  return (
    <section id="hosts" className="py-20 text-white" style={{ backgroundColor: COLOUR.dark }}>
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <p className={TYPE.eyebrow} style={{ color: COLOUR.onDark }}>
            If you have one
          </p>
          <h2 className={`mt-4 ${TYPE.h2}`} style={{ fontFamily: "var(--font-dm-serif)" }}>
            Your space already exists.
            <br />
            Let the empty hours earn.
          </h2>
          <p className={`mt-5 max-w-2xl ${TYPE.body}`} style={{ color: "rgba(255,255,255,.82)" }}>
            Set your hours and your rate — and keep the rate. The fee is added on top and the
            practitioner pays it, so what you charge is what reaches your bank after each session.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/rent-out-your"
              className="rounded-full bg-white px-8 py-4 text-[16px] font-medium transition-transform duration-200 hover:-translate-y-0.5"
              style={{ color: COLOUR.ink }}
            >
              See what your space could earn
            </Link>
            <Link
              href="/for-hosts"
              className="rounded-full border px-8 py-4 text-[16px] font-medium text-white"
              style={{ borderColor: "rgba(255,255,255,.35)" }}
            >
              How hosting works
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Recurring() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <div
          className="overflow-hidden rounded-3xl"
          style={{ border: `1px solid ${COLOUR.line}`, backgroundColor: COLOUR.wash }}
        >
          <span
            className="block h-1.5 w-full"
            style={{ background: `linear-gradient(90deg, ${COLOUR.accent}, ${COLOUR.ink})` }}
          />
          <div className="p-8 sm:p-12">
            <h2 className={TYPE.h2} style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}>
              Need the same room every week?
            </h2>
            <p className={`mt-5 max-w-2xl ${TYPE.body}`} style={{ color: COLOUR.body }}>
              Book a run of weeks at once, at the same hour, in the same room. Your clients get a
              time they can count on and you still have not signed anything.
            </p>
            <Link
              href="/spaces"
              className={`mt-6 inline-block font-medium ${TYPE.body} underline underline-offset-4`}
              style={{ color: COLOUR.link }}
            >
              Find a room for a weekly slot →
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Trust() {
  return (
    <section className="border-t py-20" style={{ borderColor: COLOUR.line, backgroundColor: COLOUR.wash }}>
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <h2 className={TYPE.h2} style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}>
            Built for people who work
            <br className="hidden sm:block" /> for themselves.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((item, index) => (
            <Reveal key={item.title} delay={index * 70}>
              <div
                className="h-full rounded-2xl bg-white p-6"
                style={{ border: `1px solid ${COLOUR.line}` }}
              >
                <span className="block h-1 w-9 rounded-full" style={{ backgroundColor: COLOUR.accent }} />
                <h3 className={`mt-4 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                  {item.title}
                </h3>
                <p className={`mt-2 ${TYPE.small}`} style={{ color: COLOUR.body }}>
                  {item.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * How to put it on a phone, said honestly and briefly.
 *
 * There is no App Store listing, so there are no store badges — a badge that
 * opens nothing would be a promise broken in the first second. It does install
 * as a progressive web app, so this says the two taps that do it, in a band
 * rather than the full-height section it used to be. Installing is what
 * somebody does after deciding, not instead of deciding.
 */
function Install() {
  return (
    <section className="border-t py-12" style={{ borderColor: COLOUR.line }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6">
        <div>
          <h2 className={TYPE.h3} style={{ color: COLOUR.ink }}>
            Take {BRAND} with you.
          </h2>
          <p className={`mt-1.5 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
            No app store. iPhone: Safari → Share → Add to Home Screen. Android: Chrome → menu →
            Install app.
          </p>
        </div>

        <a
          href={APP_URL}
          className="rounded-full px-7 py-3.5 text-[16px] font-medium text-white"
          style={{ backgroundColor: COLOUR.ink }}
        >
          Open {BRAND}
        </a>
      </div>
    </section>
  );
}
