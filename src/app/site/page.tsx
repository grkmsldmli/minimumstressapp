import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SpaceCarousel, type Slide } from "@/components/site/space-carousel";
import { SpaceSearch } from "@/components/site/space-search";
import { APP_URL, BRAND } from "@/lib/company";

/**
 * A marketplace homepage, which is a different thing from a brochure.
 *
 * The earlier version was short and well written and read as a company
 * describing itself: a headline, three photographs, two paragraphs, and an
 * "install it on your phone" section taking up a third of the page. Nothing on
 * it was wrong. What was missing was the product — a visitor could read the
 * whole thing without once being offered the thing the site does, which is
 * find a room in a town.
 *
 * So the search comes first, and everything below it answers a question
 * somebody has after seeing it: what kinds of room, how does this work, what
 * is in it for me on each side, and can I have the same hour every week.
 *
 * Two things are deliberately not here, and both were asked for.
 *
 * There is no "spaces available near you" strip of real listings. There are no
 * listings. A row of invented rooms is the single most damaging thing a
 * marketplace homepage can do — it is checkable in one click, and the person
 * who checks is exactly the practitioner we need. The section arrives when the
 * rooms do.
 *
 * And the search does not pretend. It is a real search that leads to a real
 * page, which today answers honestly that nothing is listed in that town yet.
 * That is worth more than a box that quietly does nothing: it is the same
 * affordance, it tells the truth, and the day there is inventory nothing here
 * has to change.
 */

export const metadata: Metadata = {
  title: "Wellness Spaces for Rent by the Hour",
  description:
    "Treatment rooms, Pilates studios, private consulting rooms and movement space, rented " +
    "by the hour. No lease, no deposit — or list the space you already have.",
};

/**
 * The hero, which moves.
 *
 * Labelled the way a listing is labelled inside the app, so the marketing site
 * and the product read as one thing rather than two.
 */
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
 * The four groups, in the words somebody searches with.
 *
 * Not the four categories the app organises itself by — nobody looks for a
 * "movement studio" by that name. Each card points at the search it stands
 * for, so the card and the box in the hero do the same thing.
 */
const GROUPS = [
  {
    title: "Private rooms",
    body: "For consultations, coaching and seeing one person at a time.",
    type: "consultation-room",
  },
  {
    title: "Treatment rooms",
    body: "A couch, a sink and a door that locks — for hands-on work.",
    type: "treatment-room",
  },
  {
    title: "Pilates & movement",
    body: "Reformers, mirrors and floor enough to work on.",
    type: "pilates-studio",
  },
  {
    title: "Yoga & meditation",
    body: "Quiet rooms for classes and for sitting.",
    type: "yoga-studio",
  },
];

const STEPS = [
  { n: "1", title: "Search", body: "The kind of room you need, in the town you work in." },
  { n: "2", title: "Book", body: "Pick the hours. You pay the price on the listing, and nothing else." },
  { n: "3", title: "Work", body: "Let yourself in with the code, and see your own clients." },
];

/**
 * What the site can honestly say about itself.
 *
 * Every line here is something the product does today. "Insurance on every
 * booking" is not on this list, and neither is anything about how many rooms
 * or hosts there are — a trust section that overstates is worse than none,
 * because it is the section a careful reader checks first.
 */
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

function Hero() {
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 pb-16 pt-8 lg:grid-cols-[1fr_1.1fr] lg:pb-20">
      <div>
        <h1
          className="text-[42px] leading-[1.06] sm:text-[52px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Wellness spaces,
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            by the hour.
          </em>
        </h1>

        <p className="mt-6 max-w-md text-[17px] leading-[1.7]" style={{ color: "#5f6673" }}>
          Treatment rooms, Pilates studios, private consulting rooms and movement space — for
          the hours you need and not a month more. No lease. No deposit.
        </p>

        <SpaceSearch />

        <div className="mt-4">
          <Link href="/rent-out-your" className="text-[15px]" style={{ color: "#0EA5E9" }}>
            Have a space? See what it could earn →
          </Link>
        </div>
      </div>

      <SpaceCarousel slides={HERO} />
    </section>
  );
}

/** The kinds of room, each one a search rather than a photograph. */
function Groups() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-20">
      <h2 className="text-[14px] font-medium" style={{ color: "#0F2F55" }}>
        Explore by space
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {GROUPS.map((group) => (
          <Link
            key={group.type}
            href={`/spaces?type=${group.type}`}
            className="rounded-2xl p-5"
            style={{ border: "1px solid #e7eef6" }}
          >
            <span className="block text-[16px]" style={{ color: "#0F2F55" }}>
              {group.title}
            </span>
            <span className="mt-1.5 block text-[13.5px] leading-[1.65]" style={{ color: "#8a94a3" }}>
              {group.body}
            </span>
            <span className="mt-3 block text-[13.5px]" style={{ color: "#0EA5E9" }}>
              Explore spaces →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-y py-16" style={{ borderColor: "#eef2f6", backgroundColor: "#f8fbfd" }}>
      <div className="mx-auto max-w-5xl px-6">
        <h2
          className="text-[28px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Space when you need it.
        </h2>

        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-medium"
                style={{ backgroundColor: "#e7f4fd", color: "#0EA5E9" }}
              >
                {step.n}
              </span>
              <h3 className="mt-3 text-[17px]" style={{ color: "#0F2F55" }}>
                {step.title}
              </h3>
              <p className="mt-1.5 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForPractitioners() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      {/* One column with a measure on it, not a two-column grid with an empty
          half — the list below reads badly at full page width. */}
      <div className="max-w-2xl">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#0EA5E9" }}>
            If you need a space
          </p>
          <h2
            className="mt-3 text-[32px] leading-[1.15]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            A professional room,
            <br />
            without the lease.
          </h2>
          <p className="mt-5 text-[16px] leading-[1.8]" style={{ color: "#5f6673" }}>
            Work for yourself without signing for a studio you use six hours a week. Book the
            hour, pay the price you were shown, and let yourself in — the door code arrives the
            day before.
          </p>

          <ul className="mt-6 space-y-2.5">
            {[
              "Book by the hour, or the same hour every week",
              "Choose the town you actually work in",
              "See your own clients, in your own way",
              "Cancel 24 hours ahead and the money comes back",
            ].map((line) => (
              <li
                key={line}
                className="flex gap-3 text-[15.5px] leading-[1.7]"
                style={{ color: "#5f6673" }}
              >
                <span
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: "#0EA5E9" }}
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/spaces"
            className="mt-7 inline-block rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            Find a space
          </Link>
        </div>
      </div>
    </section>
  );
}

function ForHosts() {
  return (
    <section
      id="hosts"
      className="border-y py-16"
      style={{ borderColor: "#eef2f6", backgroundColor: "#f8fbfd" }}
    >
      <div className="mx-auto max-w-5xl px-6">
        <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#0EA5E9" }}>
          If you have one
        </p>
        <h2
          className="mt-3 text-[32px] leading-[1.15]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Your space already exists.
          <br />
          Let the empty hours earn.
        </h2>
        <p className="mt-5 max-w-2xl text-[16px] leading-[1.8]" style={{ color: "#5f6673" }}>
          Set your hours and your rate — and keep the rate. The fee is added on top and the
          practitioner pays it, so what you charge is what reaches your bank after each session.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/rent-out-your"
            className="rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            See what your space could earn
          </Link>
          <Link
            href="/for-hosts"
            className="rounded-full border px-7 py-3.5 text-[15px] font-medium"
            style={{ borderColor: "#d9e2ec", color: "#0F2F55" }}
          >
            How hosting works
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * The thing that makes this different from an event-space marketplace.
 *
 * Peerspace and the rest are built around one-off bookings of somewhere
 * unusual. A practitioner comes to the same room at the same hour every week
 * for months, which is a different product — and it is already built, in
 * lib/series.ts, so it is worth saying out loud rather than leaving somebody
 * to discover on the booking screen.
 */
function Recurring() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="rounded-2xl p-8 sm:p-10" style={{ border: "1px solid #e7eef6" }}>
        <h2
          className="text-[28px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Need the same room every week?
        </h2>
        <p className="mt-4 max-w-2xl text-[16px] leading-[1.8]" style={{ color: "#5f6673" }}>
          Book a run of weeks at once, at the same hour, in the same room. Your clients get a
          time they can count on and you still have not signed anything.
        </p>
        <Link href="/spaces" className="mt-5 inline-block text-[15px]" style={{ color: "#0EA5E9" }}>
          Find a room for a weekly slot →
        </Link>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="border-t py-16" style={{ borderColor: "#eef2f6" }}>
      <div className="mx-auto max-w-5xl px-6">
        <h2
          className="text-[28px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Built for people who work for themselves.
        </h2>

        <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((item) => (
            <div key={item.title}>
              <h3 className="text-[16px]" style={{ color: "#0F2F55" }}>
                {item.title}
              </h3>
              <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * How to put it on a phone, said honestly and said briefly.
 *
 * There is no App Store or Play Store listing, so there are no store badges. A
 * badge that opens nothing would be a promise broken in the first second. It
 * does install — it is a progressive web app — so this says the two taps that
 * do it, in a band rather than in the full-height section it used to occupy.
 * Installing is what somebody does after deciding, not instead of deciding.
 */
function Install() {
  return (
    <section className="py-12 text-white" style={{ backgroundColor: "#0F2F55" }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-6">
        <div>
          <h2 className="text-[20px]" style={{ fontFamily: "var(--font-dm-serif)" }}>
            Take {BRAND} with you.
          </h2>
          <p className="mt-1.5 text-[14.5px] leading-[1.7]" style={{ color: "rgba(255,255,255,.72)" }}>
            No app store. iPhone: Safari → Share → Add to Home Screen. Android: Chrome → menu →
            Install app.
          </p>
        </div>

        <a
          href={APP_URL}
          className="rounded-full bg-white px-7 py-3 text-[15px] font-medium"
          style={{ color: "#0F2F55" }}
        >
          Open {BRAND}
        </a>
      </div>
    </section>
  );
}
