import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SleepTool } from "@/components/site/sleep-tool";
import { BRAND } from "@/lib/company";

export const metadata: Metadata = {
  title: "Sleep Score",
  description:
    "Twelve questions drawn from a pool, scored across getting to sleep, circadian rhythm, " +
    "quality, recovery and disruptors.",
};

export default function SleepScorePage() {
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
            Is your sleep actually
            <br />
            <em className="italic" style={{ color: "#3B6FD4" }}>
              restoring you?
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            There is a difference between sleeping and recovering. Twelve questions drawn from a
            pool, scored across five dimensions — about three minutes.
          </p>

          <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            Answer for an ordinary week rather than your worst one. Nothing is stored and nothing
            is emailed.
          </p>

          <div className="mt-12">
            <SleepTool />
          </div>

          <p
            className="mt-12 rounded-2xl p-6 text-[14px] leading-[1.75]"
            style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
          >
            This is information, not medical advice, and not a diagnosis. Sleep problems can have
            causes a questionnaire cannot see — apnoea, restless legs and thyroid trouble among
            them. {BRAND} is not a medical provider. If your nights have been like this for months,
            or somebody has told you that you stop breathing in your sleep, that is worth a doctor.
          </p>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
