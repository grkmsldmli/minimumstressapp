import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SUPPORT_EMAIL } from "@/lib/company";

/**
 * The index for writing that has not moved yet.
 *
 * Fifteen posts are still in Shopify and cannot be invented here, so this page
 * exists for one reason: every /blogs/... address in the old sitemap now lands
 * on it, and a redirect into a 404 is worse than no redirect at all.
 *
 * It says plainly that the writing is being moved rather than pretending to be
 * a full archive with nothing in it — and it sends people to the tools, which
 * are the thing on this site that does work today.
 */

export const metadata: Metadata = {
  title: "Guides",
  description:
    "The Minimum Stress guides are being moved across. In the meantime, the free tools are here.",
  // Nothing to index yet, and asking for it would put an empty page in results
  // under terms the articles themselves should hold.
  robots: { index: false, follow: true },
};

export default function ArticlesPage() {
  return (
    <>
      <SiteHeader width="narrow" />

      <main className="mx-auto max-w-2xl px-6 pb-24 pt-6">
        <h1
          className="text-[36px] leading-[1.12] sm:text-[42px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          The guides are
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            moving here.
          </em>
        </h1>

        <div className="mt-8 space-y-5 text-[16.5px] leading-[1.85]" style={{ color: "#5f6673" }}>
          <p>
            We are rebuilding this site, and the writing is the part still to come across — the
            Bay Area wellness guide, the pieces on burnout, sleep, inflammation and what BMI
            actually measures.
          </p>
          <p>
            If you followed a link to one of them and landed here, that is why. Nothing has been
            deleted.
          </p>
        </div>

        <div className="mt-10 rounded-2xl p-6" style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}>
          <p className="text-[15px] leading-[1.8]" style={{ color: "#5f6673" }}>
            The free tools are already here — ten of them, and none asks for your email before it
            gives you a result.
          </p>
          <Link
            href="/tools"
            className="mt-4 inline-block rounded-full px-6 py-3 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            Open the tools
          </Link>
        </div>

        <p className="mt-8 text-[14.5px] leading-[1.75]" style={{ color: "#8a94a3" }}>
          Looking for something specific?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#0EA5E9" }}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </main>

      <SiteFooter width="narrow" />
    </>
  );
}
