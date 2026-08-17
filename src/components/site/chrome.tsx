import Image from "next/image";
import Link from "next/link";

import { APP_URL, BRAND } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * The bar at the top and the line at the bottom, written once.
 *
 * They were copied into the homepage, the hub and the BMI page within an hour
 * of each other, and had already drifted: three different max-widths and two
 * different sets of links. Chrome that differs page to page is how a site
 * starts feeling assembled rather than made.
 */

/**
 * Matches the content width of the page it sits on.
 *
 * "Matches" is the whole job and it stopped being true: the homepage moved to
 * six and the bar above it stayed at five, so the logo sat a visible thirty
 * pixels inside the headline underneath it. Chrome that does not line up with
 * its page is the thing that reads as amateur before anybody can say why.
 */
type Width = "narrow" | "wide" | "full";

const MAX: Record<Width, string> = {
  narrow: "max-w-3xl",
  wide: "max-w-5xl",
  full: "max-w-6xl",
};

export function SiteHeader({ width = "wide" }: { width?: Width }) {
  return (
    <header className={`mx-auto flex ${MAX[width]} items-center justify-between px-6 py-6`}>
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
 * The last place the failing grey survived.
 *
 * #8a94a3 sits at 3.07:1 on white where AA asks for 4.5. The palette round
 * fixed the pages and did not touch the chrome, which is exactly how a colour
 * like that outlives the change meant to remove it: nobody looks at the footer.
 */
export function SiteFooter({ width = "wide" }: { width?: Width }) {
  return (
    <footer className="border-t py-10" style={{ borderColor: COLOUR.line }}>
      <div
        className={`mx-auto flex ${MAX[width]} flex-wrap items-center justify-between gap-4 px-6 ${TYPE.small}`}
        style={{ color: COLOUR.muted }}
      >
        <span>
          © {new Date().getFullYear()} {BRAND}
        </span>

        <nav className="flex flex-wrap gap-6">
          <Link href="/tools">Free tools</Link>
          <Link href="/about">About</Link>
          {/*
            The terms and the privacy notice live in the app, because that is
            where they are agreed to and where the version somebody accepted is
            recorded. Two copies of a contract is one too many.
          */}
          <a href={`${APP_URL}/terms`}>Terms</a>
          <a href={`${APP_URL}/privacy`}>Privacy</a>
        </nav>
      </div>
    </footer>
  );
}
