import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SectionedTool } from "@/components/site/sectioned-tool";
import { gut } from "@/lib/assessments/gut";
import { BRAND } from "@/lib/company";
import { Disclaimer } from "@/components/site/disclaimer";

export const metadata: Metadata = {
  title: "Gut Health Score",
  description: "Fifteen questions across digestion, microbiome diversity, the gut-brain axis, inflammation signals and daily habits.",
};

export default function Page() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
      <div className="max-w-3xl">
          <Link href="/assessments" className="text-[14px]" style={{ color: "#0EA5E9" }}>
            ← All assessments
          </Link>

          <h1
            className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#1a2744" }}
          >
            How healthy is your
            <br />
            <em className="italic" style={{ color: "#0EA5E9" }}>
              gut ecosystem?
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Fifteen questions across five dimensions — digestion, the variety in what you eat, how stress lands in your stomach, inflammation signals, and the daily habits underneath. About four minutes.
          </p>

          <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            Answer for an ordinary month rather than your worst week. Nothing is stored and nothing is emailed.
          </p>

          <div className="mt-12">
            <SectionedTool assessment={gut} />
          </div>

          <Disclaimer>
            This is information, not medical advice, and not a diagnosis. Persistent digestive symptoms can have causes a questionnaire cannot see — coeliac disease and inflammatory bowel disease among them — and blood in the stool or unexplained weight loss should be seen by a doctor promptly rather than scored here. {BRAND} is not a medical provider.
          </Disclaimer>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
