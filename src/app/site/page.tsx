import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Reveal } from "@/components/site/reveal";
import { SpaceCarousel, type Slide } from "@/components/site/space-carousel";
import { SpaceSearch } from "@/components/site/space-search";
import { APP_URL, BRAND } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";
import { CATEGORIES, type CategoryKey } from "@/lib/taxonomy";

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
  title: "Wellness Spaces for Rent",
  description:
    "Treatment rooms, Pilates studios, private consulting rooms and movement space, rented " +
    "for as long as you need. No lease, no deposit — or list the space you already have.",
};

/*
 * Five, not six. The open-plan room came out of the rotation when it took a
 * place of its own further down the page — the same photograph twice on one
 * page reads as a company with five photographs pretending to have six.
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
    src: "/photos/moment-choosing.webp",
    label: "Find a room",
    alt: "A practitioner sitting with her phone, choosing a room, with a reformer studio behind her.",
  },
  {
    src: "/photos/room-consulting.webp",
    label: "Consulting space",
    alt: "A consulting room with two wooden-framed chairs facing each other over a low table.",
  },
];

/** What each of the four is for, in one line a stranger can act on. */
const BLURBS: Record<CategoryKey, string> = {
  physical: "Floor to move on — reformers, mats and mirrors, for the session you have planned.",
  traditional: "Hands-on rooms with a couch and a sink, for treatment work.",
  social: "A private room with two chairs, for seeing one person at a time.",
  spirit: "Still, quiet rooms for sitting, breathwork and guided practice.",
};

/**
 * The use each category opens on: the one sharing its room type's name.
 *
 * A category is not a `suitable_for` slug, and the search takes slugs — so
 * rather than teach the search a second vocabulary, each card opens the
 * broadest use inside it.
 */
const GENERIC_USE: Record<CategoryKey, string> = {
  physical: "movement-studio",
  traditional: "treatment-room",
  social: "consultation-room",
  spirit: "meditation-room",
};

/**
 * The four, taken from lib/taxonomy rather than written out again here.
 *
 * They used to be four groupings invented for this page, which drifted from
 * the four the app actually organises itself by the moment either changed.
 * Now the homepage says what the product says.
 *
 * Each links to the search on its own generic use — the one whose name matches
 * the room type — so "Holistic Practice Rooms" opens treatment rooms rather
 * than a category the search does not understand. The finer uses under it
 * (massage, acupuncture, skincare) are reached from there.
 */
const GROUPS = CATEGORIES.map((category) => ({
  key: category.key,
  title: category.label,
  body: BLURBS[category.key],
  type: GENERIC_USE[category.key],
  gradient: category.gradient,
}));

const STEPS = [
  { n: "1", title: "Search", body: "Find a room near you, for the kind of work you do." },
  { n: "2", title: "Book", body: "Choose your hours and pay the price on the listing." },
  { n: "3", title: "Work", body: "Let yourself in and see your own clients." },
];

/**
 * Why book here rather than anywhere, said as what this actually does.
 *
 * The four before these were marketplace boilerplate — one price, no minimum,
 * every room checked, free cancellation — and two of them were promises rather
 * than descriptions. "Every room is checked" is only true for as long as
 * somebody keeps opening every listing by hand, and "free cancellation" reads
 * as a guarantee that a policy change quietly turns into a lie. A card that
 * has to be revisited every time an operational decision changes is a card
 * that will eventually be wrong without anybody noticing.
 *
 * These four describe the product instead. Each one is true because of how the
 * thing is built, not because of a rule we are currently keeping — and the
 * pricing card promises that the terms are shown, which stays true whatever
 * the terms become.
 */
const TRUST = [
  {
    title: "Book only what you need",
    body:
      "A single session, a group class, or the same time every week. No lease, no long-term " +
      "commitment.",
  },
  {
    title: "Know what's included",
    body:
      "The room setup, what is in it, how you get in and anything to bring — all on the listing, " +
      "before you book.",
  },
  {
    title: "Spaces made for practice",
    body:
      "Every listing says what it suits, from movement and coaching to holistic practice and " +
      "meditation.",
  },
  {
    title: "Clear pricing and cancellation",
    body: "The total price and the cancellation terms are in front of you before you confirm.",
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
        <Recurring />
        <ForHosts />
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
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-6 lg:grid-cols-[1fr_1.25fr] lg:pb-24">
      <div>
        {/*
          "By the hour" was too narrow a thing to lock the brand to. It is
          accurate about the unit and wrong about the offer: the same room takes
          a one-to-one session, a small group, or the same slot every week for a
          term, and a headline that says "hour" makes the last two sound like
          they are not on sale.
          
          "Several hours" is deliberately not claimed. A session is sixty
          minutes and consecutive slots are separate bookings, so the half-day
          this line could have implied is not something the product does yet.
          The word "hour" stays everywhere it is a fact — the prices, the FAQ,
          the page titles people actually search.
        */}
        <h1
          className={TYPE.hero}
          style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
        >
          Wellness space,
          <br />
          <em className="italic" style={{ color: COLOUR.accent }}>
            on your schedule.
          </em>
        </h1>

        <p className={`mt-6 max-w-lg ${TYPE.lead}`} style={{ color: COLOUR.body }}>
          Private rooms and studios for one-to-one sessions, group practice, or the same time
          every week. No lease, no deposit.
        </p>

        <SpaceSearch />

        <p className={`mt-5 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
          Have a space?{" "}
          <Link href="/rent-out-your" className="underline underline-offset-2" style={{ color: COLOUR.link }}>
            Get the quote
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
          <Reveal key={group.key} delay={index * 70}>
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
    <section
      id="how-it-works"
      className="border-y py-20"
      style={{ borderColor: COLOUR.line, backgroundColor: COLOUR.wash }}
    >
      <div className="mx-auto max-w-6xl px-6">
        {/*
          The heading had the left third of a wide page and nothing beside it.
          Pairing it with the one sentence that frames the three steps fills the
          row and earns its space — the alternative was more air.
        */}
        <Reveal>
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <h2 className={TYPE.h2} style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}>
              How it works.
            </h2>
            <p className={`max-w-md lg:pt-2 ${TYPE.body}`} style={{ color: COLOUR.body }}>
              No viewings, no negotiation, no deposit. Three steps, about five minutes.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid grid-cols-3 gap-4 sm:mt-14 sm:gap-8">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delay={index * 110} className="relative">
              {/*
                A rule from this number to the next, so the three read as one
                sequence rather than three facts standing near each other.

                One segment per step rather than a single line across the row,
                which is what this was first: a line inset from the container's
                edges ran three hundred pixels past the last circle into empty
                space, and sat eighteen pixels above the numbers because the
                container's top is not the circles' top. Anchoring each segment
                to its own step makes both exact and keeps them exact — the
                negative right offset is the grid gap, so the segment ends
                precisely where the next column, and therefore the next circle,
                begins.
              */}
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[42px] top-[18px] h-px sm:left-[52px] sm:top-[22px]"
                  style={{ right: "-2rem", backgroundColor: COLOUR.line }}
                />
              )}

              <span
                className="relative flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-medium text-white sm:h-11 sm:w-11 sm:text-[17px]"
                style={{ backgroundColor: COLOUR.accent }}
              >
                {step.n}
              </span>
              <h3
                className="mt-4 text-[16px] font-medium sm:mt-5 sm:text-[21px]"
                style={{ color: COLOUR.ink }}
              >
                {step.title}
              </h3>
              <p
                className="mt-1.5 text-[13.5px] leading-[1.55] sm:mt-2 sm:text-[17px] sm:leading-[1.75]"
                style={{ color: COLOUR.body }}
              >
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
        {/*
          A photograph beside the argument rather than under it.

          Both of these sections were a column of text with the right-hand half
          of the page empty, which reads as a page that stopped rather than one
          that ended. The pictures are not decoration here: this one is the
          sentence "see your own clients, in your own way" as a thing rather
          than a claim.
        */}
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div>
            <Eyebrow>If you need a space</Eyebrow>
            <h2
              className={`mt-4 ${TYPE.h2}`}
              style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
            >
              A professional room,
              <br />
              no lease required.
            </h2>
            <p className={`mt-5 ${TYPE.body}`} style={{ color: COLOUR.body }}>
              You need a room a few hours a week, not a studio all year. Book the hours you
              need, see your clients, and leave.
            </p>

            <ul className="mt-7 space-y-3">
              {[
                "Book only the time you need — one session, a few hours, or recurring",
                "Find spaces close to where you already work",
                "Bring your own clients or participants",
                "Cancel 24+ hours ahead at no charge",
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

          {/* Second in the markup, so a phone reads the argument before the
              picture — the text is what somebody scrolled here for. */}
          <div className="overflow-hidden rounded-3xl" style={{ border: `1px solid ${COLOUR.line}` }}>
            <Image
              src="/photos/practitioner-session.webp"
              alt="A practitioner kneeling beside a client on a mat, working on their leg, in a bright room with a window onto trees."
              width={1672}
              height={941}
              sizes="(min-width: 1024px) 46vw, 100vw"
              className="aspect-[4/3] h-full w-full object-cover"
            />
          </div>
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
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
            {/*
              An empty room, and the emptiness is the argument. Every other
              picture on this page has somebody in it; this one is a made-up
              treatment table with nobody at it and the sun going to waste,
              which is the whole of what the section says.

              First in the markup and second on a phone — `order` keeps the
              heading above the photograph on a narrow screen without moving
              the picture to the right on a wide one.
            */}
            <div
              className="order-2 overflow-hidden rounded-3xl lg:order-1"
              style={{ border: "1px solid rgba(255,255,255,.16)" }}
            >
              <Image
                src="/photos/room-open-plan.webp"
                alt="An empty open room in afternoon sun, with a made treatment table at one end and a mat at the other."
                width={1672}
                height={941}
                sizes="(min-width: 1024px) 46vw, 100vw"
                className="aspect-[4/3] h-full w-full object-cover"
              />
            </div>

            <div className="order-1 lg:order-2">
              <p className={TYPE.eyebrow} style={{ color: COLOUR.onDark }}>
                If you have one
              </p>
              <h2 className={`mt-4 ${TYPE.h2}`} style={{ fontFamily: "var(--font-dm-serif)" }}>
                Your space already exists.
                <br />
                Let the empty hours earn.
              </h2>
              <p className={`mt-5 ${TYPE.body}`} style={{ color: "rgba(255,255,255,.82)" }}>
                You set the hours and the rate, and you keep the rate. Our fee is added on top
                and paid by the practitioner. After each session the money goes to your bank.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/rent-out-your"
                  className="rounded-full bg-white px-8 py-4 text-[16px] font-medium transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ color: COLOUR.ink }}
                >
                  Get the quote
                </Link>
                <Link
                  href="/for-hosts"
                  className="rounded-full border px-8 py-4 text-[16px] font-medium text-white"
                  style={{ borderColor: "rgba(255,255,255,.35)" }}
                >
                  How hosting works
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Recurring() {
  return (
    <section id="recurring" className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <div
          className="overflow-hidden rounded-3xl"
          style={{ border: `1px solid ${COLOUR.line}`, backgroundColor: COLOUR.wash }}
        >
          <span
            className="block h-1.5 w-full"
            style={{ background: `linear-gradient(90deg, ${COLOUR.accent}, ${COLOUR.ink})` }}
          />
          <div className="grid items-center lg:grid-cols-[1fr_1fr]">
            <div className="p-8 sm:p-12">
              <h2
                className={TYPE.h2}
                style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
              >
                Need the same room every week?
              </h2>
              <p className={`mt-5 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                Book several weeks at once — same room, same hour. Your clients get a regular
                time and you still have no contract.
              </p>
              <Link
                href="/spaces"
                className={`mt-6 inline-block font-medium ${TYPE.body} underline underline-offset-4`}
                style={{ color: COLOUR.link }}
              >
                Find a room for a weekly slot →
              </Link>
            </div>

            {/*
              A class already sitting in a room somebody booked for the afternoon,
              with the phone that booked it in the frame. It is the argument
              this section is making rather than a picture beside it.
            */}
            <Image
              src="/photos/moment-class.webp"
              alt="Four people sitting on mats in a bright studio, with a phone on a bench in the foreground showing the room they are in."
              width={1448}
              height={1086}
              sizes="(min-width: 1024px) 36rem, 100vw"
              className="h-full w-full object-cover"
            />
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
            Why people book with us.
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
