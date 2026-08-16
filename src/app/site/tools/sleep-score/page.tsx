import Link from "next/link";
import type { Metadata } from "next";

import { AssessmentTool } from "@/components/site/assessment-tool";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { sleep } from "@/lib/assessments/sleep";
import { BRAND } from "@/lib/company";

export const metadata: Metadata = {
  title: "Sleep Score",
  description:
    "Twelve questions about your nights, scored across getting to sleep, staying asleep, " +
    "waking up and rhythm — with one thing to change first.",
};

export default function SleepScorePage() {
  return (
    <>
      <SiteHeader width="narrow" />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-4">
        <Link href="/tools" className="text-[14px]" style={{ color: "#0EA5E9" }}>
          ← All tools
        </Link>

        <h1
          className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Eight hours in bed
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            is not eight hours of sleep.
          </em>
        </h1>

        <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
          Twelve questions, about three minutes. It looks at four things separately — getting to
          sleep, staying asleep, how you wake, and how steady your timing is — because they fail
          in different ways and want different answers.
        </p>

        <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
          Answer for an ordinary week rather than your worst one. It is not a diagnosis and it is
          not stored.
        </p>

        <div className="mt-12">
          <AssessmentTool assessment={sleep} />
        </div>

        <p
          className="mt-12 rounded-2xl p-6 text-[14px] leading-[1.75]"
          style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
        >
          This is information, not medical advice, and not a diagnosis. Sleep problems can have
          causes a questionnaire cannot see — apnoea and thyroid trouble among them.{" "}
          {BRAND} is not a medical provider. If your nights have been like this for months, that
          is worth a doctor rather than another article.
        </p>
      </main>

      <SiteFooter width="narrow" />
    </>
  );
}
