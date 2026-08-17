import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SectionedTool } from "@/components/site/sectioned-tool";
import { inflammation } from "@/lib/assessments/inflammation";
import { BRAND } from "@/lib/company";

export const metadata: Metadata = {
  title: "Inflammation Score",
  description: "Fifteen questions across diet, physical symptoms, metabolic markers, lifestyle drivers and recovery capacity.",
};

export default function Page() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
      <div className="max-w-3xl">
          <Link href="/tools" className="text-[14px]" style={{ color: "#0EA5E9" }}>
            ← All tools
          </Link>

          <h1
            className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#1a2744" }}
          >
            Is your body
            <br />
            <em className="italic" style={{ color: "#0EA5E9" }}>
              quietly inflamed?
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Fifteen questions across five dimensions — what you eat, what your body is doing, your metabolic markers, the habits around them, and how well you recover. About four minutes.
          </p>

          <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            Answer for how things have been recently rather than at your best. Nothing is stored and nothing is emailed.
          </p>

          <div className="mt-12">
            <SectionedTool assessment={inflammation} />
          </div>

          <p
            className="mt-12 rounded-2xl p-6 text-[14px] leading-[1.75]"
            style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
          >
            This is information, not medical advice, and not a measurement. Inflammation is measured in blood — hs-CRP and IL-6 — and nothing here is a substitute for that. Joint pain, persistent fatigue and recurring symptoms have many causes, several of them treatable, and they are worth taking to a doctor. {BRAND} is not a medical provider.
          </p>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
