import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SectionedTool } from "@/components/site/sectioned-tool";
import { cortisol } from "@/lib/assessments/cortisol";
import { BRAND } from "@/lib/company";
import { Disclaimer } from "@/components/site/disclaimer";

export const metadata: Metadata = {
  title: "Cortisol Assessment",
  description: "Fifteen questions across five dimensions — morning activation, stress reactivity, energy rhythm, sleep and lifestyle load.",
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
            Is your cortisol
            <br />
            <em className="italic" style={{ color: "#0EA5E9" }}>
              working for or against you?
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Cortisol is the hormone that gets you out of bed and the one that keeps you awake at two in the morning. Fifteen questions across five dimensions, about four minutes.
          </p>

          <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            This does not measure cortisol. It scores what you tell it about your week, in the pattern a dysregulated stress response tends to leave.
          </p>

          <div className="mt-12">
            <SectionedTool assessment={cortisol} />
          </div>

          <Disclaimer>
            This is information, not medical advice, and it is not a measurement of cortisol — that needs a blood, saliva or urine test. It cannot see thyroid trouble, Cushing&rsquo;s or Addison&rsquo;s, all of which look like this from the outside. If you suspect a hormonal condition, that is a doctor and a laboratory rather than a questionnaire. {BRAND} is not a medical provider.
          </Disclaimer>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
