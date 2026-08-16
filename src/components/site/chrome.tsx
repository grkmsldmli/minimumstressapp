import Image from "next/image";
import Link from "next/link";

import { APP_URL, BRAND } from "@/lib/company";

/**
 * The bar at the top and the line at the bottom, written once.
 *
 * They were copied into the homepage, the hub and the BMI page within an hour
 * of each other, and had already drifted: three different max-widths and two
 * different sets of links. Chrome that differs page to page is how a site
 * starts feeling assembled rather than made.
 */

/** Matches the content width of the page it sits on. */
type Width = "narrow" | "wide";

const MAX: Record<Width, string> = {
  narrow: "max-w-3xl",
  wide: "max-w-5xl",
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
          className="h-10 w-auto sm:h-11"
        />
      </Link>

      <nav className="flex items-center gap-6 text-[14px]" style={{ color: "#5f6673" }}>
        <Link href="/tools" className="hidden sm:inline">
          Free tools
        </Link>
        <Link href="/about" className="hidden sm:inline">
          About
        </Link>
        <a
          href={APP_URL}
          className="rounded-full px-5 py-2.5 font-medium text-white"
          style={{ backgroundColor: "#0F2F55" }}
        >
          Open the app
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter({ width = "wide" }: { width?: Width }) {
  return (
    <footer className="border-t py-9" style={{ borderColor: "#eef2f6" }}>
      <div
        className={`mx-auto flex ${MAX[width]} flex-wrap items-center justify-between gap-4 px-6 text-[13.5px]`}
        style={{ color: "#8a94a3" }}
      >
        <span>
          © {new Date().getFullYear()} {BRAND}
        </span>

        <nav className="flex flex-wrap gap-5">
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
