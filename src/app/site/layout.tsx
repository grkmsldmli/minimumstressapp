import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";

import { BRAND } from "@/lib/company";

/**
 * The content site's own typeface, which is not the app's.
 *
 * The app is set in Lora and Poppins and reads as a tool. This side is a
 * magazine — long articles, assessments, a homepage somebody lands on from a
 * search — and it has been set in DM Serif Display and DM Sans since it was
 * built on Shopify. Keeping that is not nostalgia: it is what every existing
 * article, every emailed result, and the logo lockup already look like.
 *
 * Loaded here rather than in the root layout so the app never pays for fonts
 * it does not draw.
 */
const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND} — Understand your stress, and what to do about it`,
    template: `%s · ${BRAND}`,
  },
  description:
    "Free wellness assessments, practical guides, and a way to find the right practitioner near you.",
};

/**
 * Wraps rather than replaces the root layout.
 *
 * Next allows a second root layout through route groups, but only by removing
 * the top-level one and moving every existing route — including the manifest
 * and the OpenGraph image, which have to stay where they are — into a group
 * of their own. That is a large change to a working marketplace for the sake
 * of a marketing site, so this nests instead and overrides what it needs:
 * the fonts, the ground colour, and the base text colour.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${dmSerif.variable} ${dmSans.variable} min-h-screen`}
      style={{ backgroundColor: "#ffffff", color: "#1a2744", fontFamily: "var(--font-dm-sans)" }}
    >
      {children}
    </div>
  );
}
