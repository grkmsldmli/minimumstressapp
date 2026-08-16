import Image from "next/image";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SpaceCarousel, type Slide } from "@/components/site/space-carousel";
import { APP_URL, BRAND } from "@/lib/company";

/**
 * One page, and short.
 *
 * The earlier draft had six sections, a four-photograph grid and a card for
 * every step. That is a brochure for a company with a sales team. This is one
 * product with one sentence behind it — a room, an hour, a price — and a
 * visitor decides on it in about fifteen seconds, so the page is built to be
 * read in that time and get out of the way.
 *
 * The photographs carry what would otherwise be paragraphs. Three of them in a
 * row say "these are real rooms" faster and more honestly than a list of room
 * types, and cost the reader nothing.
 */

export const metadata: Metadata = {
  title: "Private wellness space by the hour",
  description:
    "Rent a private space by the hour for therapy, coaching, movement, or bodywork — " +
    "or list the space you already have. No lease, no deposit.",
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

const STRIP = [
  {
    src: "/photos/room-consulting.webp",
    alt: "A consulting room with two wooden-framed chairs facing each other over a low table, and a window onto trees.",
  },
  {
    src: "/photos/room-studio.webp",
    alt: "A movement studio with mats, bolsters and a mirror.",
  },
  {
    src: "/photos/room-open-plan.webp",
    alt: "An open room with a treatment table at one end and a mat at the other.",
  },
];

export default function SiteHome() {
  return (
    <>
      <SiteHeader />

      <main>
        <Hero />
        <Strip />
        <BothSides />
        <Install />
      </main>

      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 pb-16 pt-8 lg:grid-cols-[1fr_1.1fr] lg:pb-24">
      <div>
        <h1
          className="text-[42px] leading-[1.06] sm:text-[54px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          A private space,
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            by the hour.
          </em>
        </h1>

        <p className="mt-6 max-w-sm text-[17px] leading-[1.7]" style={{ color: "#5f6673" }}>
          Therapists, coaches and movement teachers book space by the hour from people who
          already have the space. No lease. No deposit. No month you did not use.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href={APP_URL}
            className="rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            Get the app
          </a>
          <a
            href="#hosts"
            className="rounded-full border px-7 py-3.5 text-[15px] font-medium"
            style={{ borderColor: "#d9e2ec", color: "#0F2F55" }}
          >
            I have a space
          </a>
        </div>
      </div>

      <SpaceCarousel slides={HERO} />
    </section>
  );
}

/**
 * Three rooms, no captions.
 *
 * This replaced a grid with a heading and a paragraph under each picture. The
 * pictures were already saying it.
 */
function Strip() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-20">
      <div className="grid gap-3 sm:grid-cols-3">
        {STRIP.map((photo) => (
          <div key={photo.src} className="overflow-hidden rounded-2xl">
            <Image
              src={photo.src}
              alt={photo.alt}
              width={1672}
              height={941}
              sizes="(min-width: 640px) 33vw, 100vw"
              className="aspect-[4/3] h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
      <p className="mt-5 text-[15px] leading-[1.7]" style={{ color: "#5f6673" }}>
        Treatment rooms, studios and consulting spaces across California — with the street, the
        hours and the whole price on every listing.
      </p>
    </section>
  );
}

/** The two people who arrive here, side by side, four lines each. */
function BothSides() {
  return (
    <section
      id="hosts"
      className="border-y py-16"
      style={{ borderColor: "#eef2f6", backgroundColor: "#f8fbfd" }}
    >
      <div className="mx-auto grid max-w-5xl gap-12 px-6 sm:grid-cols-2">
        <div>
          <h2
            className="text-[24px] leading-snug"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Need a space
          </h2>
          <p className="mt-3 text-[15.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Book the hour, pay the price you were shown, and let yourself in — the door code
            arrives the day before. Cancel 24 hours ahead and the money comes back.
          </p>
        </div>

        <div>
          <h2
            className="text-[24px] leading-snug"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Have a space
          </h2>
          <p className="mt-3 text-[15.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Set your rate and your hours, and the empty ones start earning. Everyone who books
            carries their own insurance. Paid to your bank after each session.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * How to put it on a phone, said honestly.
 *
 * There is no App Store or Play Store listing, so there are no store badges.
 * A badge that opens nothing would be the first promise this page makes and
 * the first one broken. It does install — it is a progressive web app, and
 * both platforms give it a home-screen icon and no browser bar — so the page
 * says which two taps do that.
 */
function Install() {
  return (
    <section className="py-20 text-white" style={{ backgroundColor: "#0F2F55" }}>
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-[30px] leading-tight" style={{ fontFamily: "var(--font-dm-serif)" }}>
          Put it on your phone.
        </h2>
        <p className="mt-4 text-[16px] leading-[1.8]" style={{ color: "rgba(255,255,255,.72)" }}>
          No app store, nothing to download. It installs from the browser and sits on your home
          screen like any other app.
        </p>

        <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
          <p className="rounded-2xl p-5 text-[14px] leading-[1.7]" style={{ backgroundColor: "rgba(255,255,255,.07)" }}>
            <strong className="block pb-1">iPhone</strong>
            <span style={{ color: "rgba(255,255,255,.72)" }}>
              Safari → Share → Add to Home Screen
            </span>
          </p>
          <p className="rounded-2xl p-5 text-[14px] leading-[1.7]" style={{ backgroundColor: "rgba(255,255,255,.07)" }}>
            <strong className="block pb-1">Android</strong>
            <span style={{ color: "rgba(255,255,255,.72)" }}>Chrome → menu → Install app</span>
          </p>
        </div>

        <a
          href={APP_URL}
          className="mt-8 inline-block rounded-full bg-white px-8 py-3.5 text-[15px] font-medium"
          style={{ color: "#0F2F55" }}
        >
          Open {BRAND}
        </a>
      </div>
    </section>
  );
}

