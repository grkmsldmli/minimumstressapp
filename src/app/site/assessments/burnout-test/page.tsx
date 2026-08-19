import Link from "next/link";
import type { Metadata } from "next";

import { BurnoutTool } from "@/components/site/burnout-tool";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { BRAND } from "@/lib/company";
import { Disclaimer } from "@/components/site/disclaimer";

export const metadata: Metadata = {
  title: "Burnout Test",
  description:
    "Ten questions drawn from a hundred, and an honest read on where you sit between " +
    "recovering and burnt out. Free, and the result is on the screen.",
};

export default function BurnoutTestPage() {
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
            Are you burning out
            <br />
            <em className="italic" style={{ color: "#1D9E75" }}>
              or burning through?
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Ten questions, drawn at random from a hundred, so it is a different test each time you
            take it. About two minutes.
          </p>

          <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            Answer honestly rather than well — nobody sees this but you. Nothing is stored and
            nothing is emailed.
          </p>

          <div className="mt-12">
            <BurnoutTool />
          </div>

          <Disclaimer>
            This is a reflection, not a diagnosis. Burnout is not a medical condition on its own,
            and low mood, exhaustion and detachment have causes a questionnaire cannot see.{" "}
            {BRAND} is not a medical provider. If your stress feels intense or unsafe, please talk
            to a doctor or a mental health professional.
          </Disclaimer>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
