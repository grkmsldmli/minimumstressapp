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
      {/*
        Smaller on a phone, and the button most of all.

        Both text links are hidden under `sm`, so on a phone this button is the
        entire nav — and it was still wearing the desktop size it was given for
        a row of three: 17px type in 24px of padding, sitting beside a 48px
        logo. It read as the loudest thing on the page before anybody had
        scrolled to what the page was about.

        The sizes are written out rather than interpolated from TYPE. Tailwind
        finds classes by reading the source text, so `sm:${TYPE.body}` compiles
        to nothing at all — the string it would need to see never appears in
        any file. The numbers still match the scale: 15px is TYPE.small, 17px
        is TYPE.body.
      */}
      <nav
        className="flex items-center gap-4 text-[15px] leading-[1.7] sm:gap-7 sm:text-[17px]"
        style={{ color: COLOUR.body }}
      >
        <Link href="/spaces" className="hidden hover:underline sm:inline">
          Find a space
        </Link>
        <Link href="/about" className="hidden hover:underline sm:inline">
          About
        </Link>
        <a
          href={APP_URL}
          className="whitespace-nowrap rounded-full px-4 py-2 font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 sm:px-6 sm:py-3"
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
/*
 * The two sides, given the same shape.
 *
 * They had drifted into different columns for the same site: one had a
 * "Questions" and the other a "Host FAQ", trust and safety appeared under
 * hosts and not under practitioners, and only one of them ended in a
 * highlighted action. A reader on the thinner side reads that as the side the
 * company cares less about, and they are not wrong to.
 *
 * So both run the same way: the action, how it works, the recurring or
 * earning question, pricing, trust, questions — and both end on the same
 * emphasis.
 */
const FOR_PRACTITIONERS = {
  links: [
    { label: "Find a space", href: "/spaces" },
    { label: "How it works", href: "/#how-it-works" },
    { label: "Recurring bookings", href: "/#recurring" },
    { label: "Trust & safety", href: "/trust" },
    { label: "Questions", href: "/faq" },
  ],
  action: { label: "Browse every space →", href: "/spaces" },
};

const FOR_HOSTS = {
  links: [
    { label: "List your space", href: `${APP_URL}?list=1` },
    { label: "How hosting works", href: "/for-hosts" },
    { label: "See your quote", href: "/rent-out-your" },
    { label: "Trust & safety", href: "/trust" },
    { label: "Host questions", href: "/for-hosts#faq" },
  ],
  action: { label: "See your quote →", href: "/rent-out-your" },
};

const COMPANY = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  /*
   * The wellness tools are kept off the marketplace chrome — they belong to
   * neither side of it and pull focus from the product. The pages and their
   * URLs stay live and remain in the sitemap (see site-map.ts), so nothing is
   * lost to search or to a direct link; they are simply not advertised here.
   */
  { label: "Terms", href: `${APP_URL}/terms` },
  /*
   * The second agreement, the one only a host accepts. It sits beside Terms
   * rather than under Hosts because it is a published document at its own
   * address, not a host feature — a host deciding whether to list reads it
   * before they have an account.
   */
  { label: "Host Terms", href: `${APP_URL}/host-terms` },
  { label: "Privacy", href: `${APP_URL}/privacy` },
  /*
   * A legal fixture for a company operating in California, and one worth
   * linking rather than burying: the page says plainly that there is nothing
   * to opt out of, which is only credible if it is easy to find.
   */
  { label: "YOUR PRIVACY CHOICES", href: "/privacy-choices" },
];

type Entry = { label: string; href: string };

function Column({
  title,
  links,
  action,
}: {
  title: string;
  links: Entry[];
  /** The one link in the column worth more than the others, where there is one. */
  action?: Entry;
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
        {action && (
          <li className="pt-2">
            <Link
              href={action.href}
              className="font-medium hover:underline"
              style={{ color: COLOUR.onDark }}
            >
              {action.label}
            </Link>
          </li>
        )}
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
        {/*
          The brand on the left, the two ways to reach us on the right.

          It used to be five columns of links with the logo squeezed into the
          first, which is the shape a footer takes when it is built one link at
          a time. Then it was the same block stacked — logo, slogan, line,
          rule, contacts — which said the right thing and ran the footer to
          most of a screen on its own.

          Side by side on a wide viewport, stacked under `lg` where there is no
          width to share. The contacts sit at the baseline of the slogan rather
          than the top of the block, so they line up with the sentence instead
          of floating beside the logo.
        */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <div>
            <Image
              src="/photos/logo-lockup.webp"
              alt={BRAND}
              width={321}
              height={120}
              className="h-11 w-auto sm:h-12"
            />

            {/*
              One accent, not a sweep through three.

              A solid colour rather than a gradient clipped to the text: the
              sweep reads as decoration applied to the sentence, and it takes
              the words out of every contrast check with it, because no letter
              then has a colour anything can measure.
            */}
            <h2
              className="mt-8 text-[30px] leading-[1.12] sm:text-[40px]"
              style={{ fontFamily: "var(--font-dm-serif)" }}
            >
              <span style={{ color: "#FFFFFF" }}>Elevate your </span>
              {/*
                Italic on the accent only, which is how the headlines on this
                site already work — Headline() sets the second half in italic
                serif and the first upright. The footer was the one place the
                pattern was not being followed.
              */}
              <em className="italic" style={{ color: COLOUR.sloganAccent }}>
                mind body &amp; spirit
              </em>
              <span style={{ color: "#FFFFFF" }}>.</span>
            </h2>

            <p className={`mt-4 max-w-md ${TYPE.small}`} style={{ color: COLOUR.onDarkBody }}>
              Flexible spaces for wellness, movement and independent practice.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 lg:shrink-0">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={`flex items-center gap-2.5 hover:underline ${TYPE.small}`}
              style={{ color: COLOUR.onDarkBody }}
            >
              <MailGlyph />
              {SUPPORT_EMAIL}
            </a>

            {/*
              A new tab, because it leaves the site — and rel="noreferrer" with
              it, which is not superstition: a target="_blank" link hands the
              opened page a handle on this one unless it is told not to.
            */}
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2.5 hover:underline ${TYPE.small}`}
              style={{ color: COLOUR.onDarkBody }}
            >
              <InstagramGlyph />
              Instagram
            </a>
          </div>
        </div>

        {/*
          Three columns across the full width rather than four.

          "Explore" went, and dropping a column out of a four-up grid leaves
          the remaining three bunched at one edge with a column of air beside
          them — so the grid is three now and they spread. Two up on a tablet,
          stacked on a phone, which is where a four-column footer was always
          going to end anyway.
        */}
        <div
          className={`mt-12 grid gap-10 border-t pt-10 sm:grid-cols-2 lg:grid-cols-3 ${TYPE.small}`}
          style={{ borderColor: "rgba(255,255,255,.16)" }}
        >
          <Column title="Practitioners" {...FOR_PRACTITIONERS} />
          <Column title="Hosts" {...FOR_HOSTS} />
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
            <FooterLink href="/privacy-choices">YOUR PRIVACY CHOICES</FooterLink>
            <FooterLink href={`${APP_URL}/terms`}>Terms</FooterLink>
            <FooterLink href={`${APP_URL}/host-terms`}>Host Terms</FooterLink>
            <FooterLink href="/contact">Support</FooterLink>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/**
 * An envelope, inline, for the same reason the Instagram mark is inline: a
 * two-line icon is not worth a request, and an icon font or a sprite would put
 * the footer's appearance behind something that can fail to load.
 */
function MailGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={COLOUR.sloganAccent}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </svg>
  );
}
