import Image from "next/image";
import Link from "next/link";

import { APP_URL, BRAND, INSTAGRAM_URL, LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * The bar at the top and the footer at the bottom, written once.
 *
 * They were copied into the homepage, the hub and the BMI page within an hour
 * of each other, and had already drifted: three different max-widths and two
 * different sets of links. Chrome that differs page to page is how a site
 * starts feeling assembled rather than made.
 */

/**
 * One measure, for every page, with no way to choose another.
 *
 * This was a prop, and the prop was the bug. Each page picked the width that
 * suited it — the homepage six, the hub and the host page five, everything
 * else three — so the logo landed in three different places depending on where
 * you had navigated from, and /about managed to set a header wider than its
 * own text. Nothing was wrong on any one page; the site was wrong between
 * them, which is the harder kind to see and the kind a visitor feels
 * immediately.
 *
 * Long-form pages stay readable by holding their text to a column inside this,
 * rather than by shrinking the whole page around it. So the logo, every
 * heading and the footer all begin at the same x, everywhere, and changing
 * page moves nothing that is not content.
 */
const MEASURE = "max-w-6xl";

export function SiteHeader() {
  return (
    <header className={`mx-auto flex ${MEASURE} items-center justify-between px-6 py-6`}>
      {/*
        The drawn lockup rather than the brand name set in the page's serif.
        They are not the same mark — the wordmark has its own letterforms and
        its own two colours — and a site that renders its own name in a
        different typeface from its logo looks like two companies.

        Alt text is the name, not "logo": a screen reader announcing "logo"
        tells somebody there is a picture, and this is a link home.
      */}
      <Link href="/" className="flex items-center">
        <Image
          src="/photos/logo-lockup.webp"
          alt={BRAND}
          width={321}
          height={120}
          priority
          className="h-12 w-auto sm:h-14"
        />
      </Link>

      {/*
        Sized against the page rather than against the old page. The type scale
        under this grew — body text from 15 to 17, the homepage headline to 62
        — and a 14px nav that looked right before now reads as something the
        design forgot.
      */}
      <nav className={`flex items-center gap-7 ${TYPE.body}`} style={{ color: COLOUR.body }}>
        <Link href="/tools" className="hidden hover:underline sm:inline">
          Free tools
        </Link>
        <Link href="/about" className="hidden hover:underline sm:inline">
          About
        </Link>
        <a
          href={APP_URL}
          className="rounded-full px-6 py-3 font-medium text-white transition-transform duration-200 hover:-translate-y-0.5"
          style={{ backgroundColor: COLOUR.ink }}
        >
          Open the app
        </a>
      </nav>
    </header>
  );
}

/**
 * The footer, as a place somebody can actually get somewhere from.
 *
 * It was a copyright line and four links. A marketplace footer is a navigation
 * surface: it is where somebody who did not find what they came for goes next,
 * and it is the site telling a crawler which pages it considers its own.
 *
 * Every link here goes somewhere that exists, which is the only rule it has.
 * The footer is on every page, so one dead link in it is a dead link
 * everywhere: a reader stops trusting the rest the first time one dead-ends,
 * and a crawler learns the site does not know what it has.
 *
 * The structure was specified with about a dozen destinations that had no page
 * behind them. Rather than drop them, most were built — pricing, trust and
 * safety, the questions, contact, and the Californian privacy-choices page —
 * and two were rescued for the cost of an id, because "How it works" and
 * "Recurring bookings" were already sections of the homepage and the host FAQ
 * was already a section of /for-hosts.
 *
 * It sits on the navy, which is where this brand's footer has always been. It
 * also finishes the job the alternating grounds do further up: the site ends
 * rather than trailing off into the same white it started in. Text on it is
 * opaque and measured rather than white at some alpha — an alpha is a guess
 * whose real contrast depends on what is behind it, and nothing checks it.
 *
 * Three are still deliberately missing. A Cancellation Policy, a Refund Policy
 * and a Wellness Disclaimer all live inside the terms already, and three
 * labels pointing at one page is three ways of saying Terms. Partnerships is
 * absent because there is no partnership programme — a page saying "write to
 * us" under that heading is a link that wastes somebody's click.
 */

/** The four rooms, in the words the categories now use. */
const EXPLORE = [
  { label: "Find a space", href: "/spaces" },
  { label: "Movement studios", href: "/spaces?type=movement-studio" },
  { label: "Consultation & coaching rooms", href: "/spaces?type=consultation-room" },
  { label: "Holistic practice rooms", href: "/spaces?type=treatment-room" },
  { label: "Meditation & breathwork spaces", href: "/spaces?type=meditation-room" },
];

const FOR_PRACTITIONERS = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Browse spaces", href: "/spaces" },
  { label: "Recurring bookings", href: "/#recurring" },
  { label: "Pricing & fees", href: "/pricing" },
  { label: "Questions", href: "/faq" },
  /*
   * The eleven wellness tools, kept and kept out of the way. They were the
   * whole of the old site and they are not the product now — a footer is
   * exactly where something like that should live.
   */
  { label: "Free tools", href: "/tools" },
];

const FOR_HOSTS = [
  { label: "List your space", href: `${APP_URL}?list=1` },
  { label: "How hosting works", href: "/for-hosts" },
  { label: "Pricing & fees", href: "/pricing" },
  { label: "Trust & safety", href: "/trust" },
  { label: "Host FAQ", href: "/for-hosts#faq" },
];

const COMPANY = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Trust & safety", href: "/trust" },
  { label: "Terms", href: `${APP_URL}/terms` },
  { label: "Privacy", href: `${APP_URL}/privacy` },
  /*
   * A legal fixture for a company operating in California, and one worth
   * linking rather than burying: the page says plainly that there is nothing
   * to opt out of, which is only credible if it is easy to find.
   */
  { label: "Your privacy choices", href: "/privacy-choices" },
];

function Column({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h2 className={TYPE.eyebrow} style={{ color: COLOUR.onDark }}>
        {title}
      </h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <FooterLink href={link.href}>{link.label}</FooterLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Instagram glyph, drawn here rather than imported.
 *
 * Lucide dropped its brand icons — trademarks are not theirs to redistribute —
 * so the alternative was a second icon package for one mark. It is a rounded
 * square, a circle and a dot; `currentColor` so it takes the colour of the
 * link it sits in, and hidden from a screen reader because the word beside it
 * already says what it is.
 */
function InstagramGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A Link for our own paths, a plain anchor for the app and for mailto. */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const className = "hover:underline";
  // Opaque rather than a white at some alpha. An alpha is a guess whose real
  // contrast depends on what is behind it; this one is measured against the
  // navy in site-theme.test.ts.
  const style = { color: COLOUR.onDarkBody };

  return href.startsWith("/") ? (
    <Link href={href} className={className} style={style}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="pt-16 pb-10 text-white" style={{ backgroundColor: COLOUR.dark }}>
      <div className={`mx-auto ${MEASURE} px-6`}>
        <div className={`grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] ${TYPE.small}`}>
          <div>
            <Image
              src="/photos/logo-lockup.webp"
              alt={BRAND}
              width={321}
              height={120}
              className="h-11 w-auto"
            />
            <p className="mt-5 max-w-xs" style={{ color: COLOUR.onDarkBody }}>
              Wellness spaces, by the hour. Private rooms for people who work for themselves —
              book only the hours you need.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-5 inline-block font-medium underline underline-offset-4"
              style={{ color: COLOUR.onDark }}
            >
              {SUPPORT_EMAIL}
            </a>

            {/*
              A new tab, because it leaves the site — and rel="noreferrer"
              with it, which is not superstition: a target="_blank" link hands
              the opened page a handle on this one unless it is told not to.
            */}
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-2.5 hover:underline"
              style={{ color: COLOUR.onDarkBody }}
            >
              <InstagramGlyph />
              Instagram
            </a>
          </div>

          <Column title="Explore" links={EXPLORE} />
          <Column title="Practitioners" links={FOR_PRACTITIONERS} />

          <div>
            <h2 className={TYPE.eyebrow} style={{ color: COLOUR.onDark }}>
              Hosts
            </h2>
            <ul className="mt-4 space-y-2.5">
              {FOR_HOSTS.map((link) => (
                <li key={link.href}>
                  <FooterLink href={link.href}>{link.label}</FooterLink>
                </li>
              ))}
              {/*
                Given weight on purpose. It is the one link on this page that
                answers a question with a number, and the number is what turns
                somebody with a spare room into a listing.
              */}
              <li className="pt-1">
                <Link href="/rent-out-your" className="font-medium hover:underline" style={{ color: COLOUR.onDark }}>
                  See what your space could earn →
                </Link>
              </li>
            </ul>
          </div>

          <Column title="Company" links={COMPANY} />
        </div>

        <div
          className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t pt-7"
          style={{ borderColor: "rgba(255,255,255,.16)", color: COLOUR.onDarkMuted }}
        >
          {/*
            The registered name, not the brand. "Minimum Stress LLC" is not the
            company; a copyright line naming an entity that does not exist is
            the one sentence on a page that is meant to be exact.
          */}
          <span className={TYPE.small}>
            © {new Date().getFullYear()} {LEGAL_ENTITY}. All rights reserved.
          </span>

          <nav className={`flex flex-wrap gap-6 ${TYPE.small}`}>
            <FooterLink href={`${APP_URL}/privacy`}>Privacy</FooterLink>
            <FooterLink href="/privacy-choices">Your privacy choices</FooterLink>
            <FooterLink href={`${APP_URL}/terms`}>Terms</FooterLink>
            <FooterLink href="/contact">Support</FooterLink>
          </nav>
        </div>
      </div>
    </footer>
  );
}
