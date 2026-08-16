import Image from "next/image";
import type { Metadata } from "next";

import { APP_URL, BRAND } from "@/lib/company";

/**
 * The front door.
 *
 * Two people arrive here wanting opposite things. A practitioner has a client
 * on Tuesday and nowhere to see them. A host has a room that is empty on
 * Tuesday. The page has to answer both without becoming a page about nothing,
 * so it leads with the practitioner — they are the side that searches — and
 * gives the host a section of their own rather than a competing headline.
 *
 * What it deliberately does not do is sell wellness. Everything here is a
 * room, an hour, and a price, because that is the whole product.
 */

export const metadata: Metadata = {
  title: "Private rooms by the hour, for practitioners",
  description:
    "Rent a private room by the hour for therapy, coaching, movement, or bodywork. " +
    "Or list the room you already have and fill the hours it sits empty.",
};

const STEPS = [
  {
    n: "01",
    title: "Find the hour you need",
    body: "Search by area and time. Every listing shows the street, the room, and the whole price before you book.",
  },
  {
    n: "02",
    title: "Book it",
    body: "Pay for the hour and nothing else. Change your mind 24 hours ahead and the money comes back.",
  },
  {
    n: "03",
    title: "Let yourself in",
    body: "Entry instructions and the door code arrive the day before. No key handover, no waiting on anyone.",
  },
];

const ROOMS = [
  {
    src: "/photos/room-treatment.webp",
    label: "Treatment rooms",
    body: "A table, a door that closes, and somewhere to set your oils down.",
  },
  {
    src: "/photos/room-consulting.webp",
    label: "Consulting rooms",
    body: "Two chairs and quiet. For therapy, coaching, and anything that is a conversation.",
  },
  {
    src: "/photos/room-studio.webp",
    label: "Movement studios",
    body: "Floor space, props, and room to stand up. For yoga, pilates, and breathwork.",
  },
  {
    src: "/photos/room-open-plan.webp",
    label: "Open rooms",
    body: "Space for a table and a mat both, when your practice is more than one thing.",
  },
];

export default function SiteHome() {
  return (
    <>
      <SiteHeader />

      <main>
        <Hero />
        <HowItWorks />
        <Rooms />
        <ForPractitioners />
        <ForHosts />
        <Install />
      </main>

      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------ */

function SiteHeader() {
  return (
    <header className="border-b" style={{ borderColor: "#eef2f6" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span
          className="text-[19px] tracking-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          {BRAND}
        </span>

        <nav className="flex items-center gap-6 text-[14px]" style={{ color: "#5f6673" }}>
          <a href="#how" className="hidden sm:inline">
            How it works
          </a>
          <a href="#hosts" className="hidden sm:inline">
            List a room
          </a>
          <a
            href={APP_URL}
            className="rounded-full px-4 py-2 font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            Open the app
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-24">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#0EA5E9" }}>
          California · by the hour
        </p>

        <h1
          className="mt-4 text-[40px] leading-[1.08] sm:text-[52px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          A private room,
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            for the hour you need it.
          </em>
        </h1>

        <p className="mt-5 max-w-md text-[16px] leading-[1.75]" style={{ color: "#5f6673" }}>
          Therapists, coaches, and movement teachers rent rooms by the hour from people who
          already have the space. No lease, no deposit, no month you did not use.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href={APP_URL}
            className="rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            Find a room
          </a>
          <a
            href="#hosts"
            className="rounded-full border px-7 py-3.5 text-[15px] font-medium"
            style={{ borderColor: "#d9e2ec", color: "#0F2F55" }}
          >
            I have a room
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl">
        <Image
          src="/photos/room-treatment.webp"
          alt="A treatment room with a made table, a window onto trees, and a low wooden cabinet."
          width={1672}
          height={941}
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="h-full w-full object-cover"
        />
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="how"
      className="border-y py-20"
      style={{ borderColor: "#eef2f6", backgroundColor: "#f8fbfd" }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <h2
          className="text-[32px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Three steps, and the room is yours.
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <div
              key={step.n}
              className="rounded-2xl bg-white p-7"
              style={{ border: "1px solid #eef2f6" }}
            >
              <span className="text-[12px] font-bold tracking-[0.1em]" style={{ color: "#0EA5E9" }}>
                {step.n}
              </span>
              <h3
                className="mt-3 text-[19px]"
                style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
              >
                {step.title}
              </h3>
              <p className="mt-2 text-[14.5px] leading-[1.7]" style={{ color: "#5f6673" }}>
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Rooms() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h2
        className="text-[32px] leading-tight"
        style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
      >
        Rooms for every kind of practice.
      </h2>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {ROOMS.map((room) => (
          <div key={room.label}>
            <div className="overflow-hidden rounded-2xl">
              <Image
                src={room.src}
                alt={room.body}
                width={1672}
                height={941}
                sizes="(min-width: 640px) 50vw, 100vw"
                className="h-full w-full object-cover"
              />
            </div>
            <h3
              className="mt-4 text-[18px]"
              style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
            >
              {room.label}
            </h3>
            <p className="mt-1 text-[14.5px] leading-[1.7]" style={{ color: "#5f6673" }}>
              {room.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ForPractitioners() {
  return (
    <section className="border-y py-20" style={{ borderColor: "#eef2f6", backgroundColor: "#f8fbfd" }}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl lg:order-2">
          <Image
            src="/photos/practitioner-setting-up.webp"
            alt="A practitioner laying folded towels on a treatment table before a session."
            width={1672}
            height={941}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="lg:order-1">
          <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#0EA5E9" }}>
            For practitioners
          </p>
          <h2
            className="mt-4 text-[32px] leading-tight"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Pay for the hours you actually work.
          </h2>
          <p className="mt-4 text-[16px] leading-[1.8]" style={{ color: "#5f6673" }}>
            A lease costs the same whether you see twelve clients that month or two. This costs
            what you use. Book a single hour, or the same hour every week for a term.
          </p>

          <ul className="mt-6 space-y-3 text-[15px] leading-[1.7]" style={{ color: "#5f6673" }}>
            <li>· The whole price before you book. The fee is inside the number, not added after.</li>
            <li>· The street is on the listing, so you can judge the trip before you pay for it.</li>
            <li>· Send your client the address and the time in one tap.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function ForHosts() {
  return (
    <section
      id="hosts"
      className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 lg:grid-cols-2"
    >
      <div className="overflow-hidden rounded-3xl">
        <Image
          src="/photos/practitioner-session.webp"
          alt="A practitioner working with a client on a mat in a sunlit room."
          width={1672}
          height={941}
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="h-full w-full object-cover"
        />
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#0EA5E9" }}>
          For hosts
        </p>
        <h2
          className="mt-4 text-[32px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Your room is empty on Tuesday afternoon.
        </h2>
        <p className="mt-4 text-[16px] leading-[1.8]" style={{ color: "#5f6673" }}>
          If you already have a treatment room, a studio, or a spare consulting room, the hours
          you are not in it are worth something. You set the rate and the hours, and nobody
          arrives outside them.
        </p>

        <ul className="mt-6 space-y-3 text-[15px] leading-[1.7]" style={{ color: "#5f6673" }}>
          <li>· You choose the hours. The room is never bookable outside them.</li>
          <li>· Everyone who books carries their own insurance and agrees to your house rules.</li>
          <li>· Paid to your bank after each session, through Stripe.</li>
        </ul>

        <a
          href={APP_URL}
          className="mt-8 inline-block rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
          style={{ backgroundColor: "#0F2F55" }}
        >
          List your room
        </a>
      </div>
    </section>
  );
}

/**
 * How to put it on a phone, said honestly.
 *
 * There is no App Store or Play Store listing, so there are no store badges
 * here. A badge that opens nothing is worse than no badge at all: it would be
 * the first promise the page makes, and it would break on the first tap.
 *
 * What is true is that it installs. It is a progressive web app, and both
 * platforms will put it on the home screen with an icon and no browser bar —
 * so the page says which two taps do that, on each.
 */
function Install() {
  return (
    <section className="py-20 text-white" style={{ backgroundColor: "#0F2F55" }}>
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-[32px] leading-tight" style={{ fontFamily: "var(--font-dm-serif)" }}>
          Put it on your phone.
        </h2>
        <p
          className="mx-auto mt-4 max-w-xl text-[16px] leading-[1.8]"
          style={{ color: "rgba(255,255,255,.72)" }}
        >
          It installs straight from the browser — no app store, nothing to download. You get an
          icon on your home screen like any other app.
        </p>

        <div className="mt-8 grid gap-4 text-left sm:grid-cols-2">
          <div className="rounded-2xl p-5" style={{ backgroundColor: "rgba(255,255,255,.07)" }}>
            <p className="text-[14px] font-semibold">iPhone</p>
            <p className="mt-1.5 text-[14px] leading-[1.7]" style={{ color: "rgba(255,255,255,.72)" }}>
              Open it in Safari, tap Share, then <strong>Add to Home Screen</strong>.
            </p>
          </div>
          <div className="rounded-2xl p-5" style={{ backgroundColor: "rgba(255,255,255,.07)" }}>
            <p className="text-[14px] font-semibold">Android</p>
            <p className="mt-1.5 text-[14px] leading-[1.7]" style={{ color: "rgba(255,255,255,.72)" }}>
              Open it in Chrome, tap the menu, then <strong>Install app</strong>.
            </p>
          </div>
        </div>

        <a
          href={APP_URL}
          className="mt-8 inline-block rounded-full bg-white px-7 py-3.5 text-[15px] font-medium"
          style={{ color: "#0F2F55" }}
        >
          Open {BRAND}
        </a>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t py-10" style={{ borderColor: "#eef2f6" }}>
      <div
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-[13.5px]"
        style={{ color: "#8a94a3" }}
      >
        <span>
          © {new Date().getFullYear()} {BRAND}
        </span>
        <nav className="flex gap-5">
          <a href={`${APP_URL}/terms`}>Terms</a>
          <a href={`${APP_URL}/privacy`}>Privacy</a>
          <a href={APP_URL}>Open the app</a>
        </nav>
      </div>
    </footer>
  );
}
