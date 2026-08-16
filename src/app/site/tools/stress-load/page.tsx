import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { AssessmentTool } from "@/components/site/assessment-tool";
import { BRAND } from "@/lib/company";
import { stressLoad } from "@/lib/stress-load";

export const metadata: Metadata = {
  title: "Stress Load Check",
  description:
    "Twelve questions about your week, scored across sleep, body, mind and load — with one " +
    "concrete thing to change first. Free, and the result is on the screen.",
};

export default function StressLoadPage() {
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
          Where is the week
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            actually landing?
          </em>
        </h1>

        <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
          Twelve questions, about four minutes. It scores four things that usually move together
          — sleep, body, mind, and how much is being asked of you — and tells you which one is
          thinnest, because that is where a change is worth the most.
        </p>

        {/*
          Said before the questions rather than after the score. Somebody
          deciding whether to spend four minutes on this deserves to know what
          it is not, at the point where the decision is being made.
        */}
        <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
          Answer honestly rather than well — nobody sees this but you. It is not a diagnosis and
          it is not stored.
        </p>

        <div className="mt-12">
          <AssessmentTool assessment={stressLoad} />
        </div>

        <p
          className="mt-12 rounded-2xl p-6 text-[14px] leading-[1.75]"
          style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
        >
          This is information, not medical advice. It scores what you told it about one week and
          cannot see anything else — it does not diagnose, treat, or rule anything out.{" "}
          {BRAND} is not a medical provider. If your answers here match how things have felt for
          a long time, that is worth taking to a doctor.
        </p>
      </main>

      <SiteFooter width="narrow" />
    </>
  );
}
