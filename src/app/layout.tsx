import type { Metadata, Viewport } from "next";
import { Lora, Poppins } from "next/font/google";

import { BRAND } from "@/lib/company";
import { siteUrl } from "@/lib/site-url";

import "./globals.css";

/**
 * Self-hosted by next/font. The prototype pulled these through an `@import`
 * inside an inline <style>, which blocks first paint on a screen whose whole
 * point is to feel calm and immediate.
 */
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["500", "600"],
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

/**
 * How the app introduces itself outside itself.
 *
 * Two audiences, and neither of them has opened it yet. A studio owner gets a
 * link in a message and decides from the card whether this is a company; a
 * practitioner saves it to their home screen and decides from the icon
 * whether it is an app. Both were bare before this: no picture, no name on the
 * home screen, and a browser bar over every screen.
 */
const DESCRIPTION =
  "Private rooms for every kind of practice — movement, coaching, meditation, and healing.";

/**
 * The title, which was the brand name and nothing else.
 *
 * That is the right answer for a tab somebody already has open and the wrong
 * one everywhere the title does its actual work: a search result, a browser's
 * address suggestions, a bookmark, a link pasted into a message. "Minimum
 * Stress" tells a practitioner who has never heard of us nothing at all, and
 * it sat directly under the .com's own line, which does say what it sells.
 *
 * Brand, what it is, and what to do about it. Kept near sixty characters,
 * because search results are cut there and a title truncated mid-word reads as
 * a broken page rather than a busy one.
 */
const SITE_TITLE = `${BRAND}: Private Wellness Space to Rent | Book Now`;

export const metadata: Metadata = {
  // Every relative URL below is resolved against this, including the
  // generated Open Graph image. Without it they resolve against localhost in
  // development and against nothing at all when a messaging app fetches them.
  //
  // Read from the deployment rather than from the intended address: until DNS
  // is pointed, an image URL on minimumstress.app is an image that does not
  // load, and a broken preview is worse than a plain link.
  metadataBase: new URL(siteUrl()),
  title: {
    default: SITE_TITLE,
    // A room's own page can name itself and still be recognisably ours. The
    // brand alone is right here: the page has already said what it is.
    template: `%s · ${BRAND}`,
  },
  description: DESCRIPTION,
  applicationName: BRAND,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: BRAND,
    title: SITE_TITLE,
    description: DESCRIPTION,
    url: siteUrl(),
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: DESCRIPTION },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // What sits under the icon on a home screen. The full name wraps to two
    // lines and is truncated; this is the half somebody actually reads.
    title: BRAND,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  formatDetection: { telephone: false },
};

/**
 * Fitted to the phone it is opened on.
 *
 * `viewportFit: cover` with the safe-area padding in globals.css is what keeps
 * the bottom action bar clear of the home indicator once this is installed and
 * there is no browser chrome to sit behind.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16304E",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lora.variable} ${poppins.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
