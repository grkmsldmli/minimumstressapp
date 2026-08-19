import Link from "next/link";
import type { Metadata } from "next";

import { BioAgeTool } from "@/components/site/bio-age-tool";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { BRAND } from "@/lib/company";
import { Disclaimer } from "@/components/site/disclaimer";

export const metadata: Metadata = {
  title: "Biological Age Calculator",
  description:
    "What your habits add up to, expressed in years — across sleep, movement, nutrition, " +
    "stress, substances, connection and recovery.",
};

export default function BiologicalAgePage() {
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
            How old is your body
            <br />
            <em className="italic" style={{ color: "#EF9F27" }}>
              actually?
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Your age, then twenty questions about the habits around it — sleep, movement, food,
            stress, smoking and drinking, connection, and how well you recover. Each one moves the
            answer by a few years in one direction or the other. About five minutes.
          </p>

          {/*
            Said before the questions rather than in the disclaimer at the end.
            The number this produces looks like a measurement and is not one, and
            somebody deciding whether to spend five minutes should know that at
            the point the decision is made.
          */}
          <p className="mt-4 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            This is an estimate from lifestyle answers, not a measurement. Real biological age is
            read from blood and DNA methylation, and nothing here can see any of that.
          </p>

          <div className="mt-12">
            <BioAgeTool />
          </div>

          <Disclaimer>
            This is information, not medical advice, and not a diagnosis. The number is an
            arithmetic summary of what you told it and is not clinically validated — genetics,
            medical history, medication and everything not asked about here matter too.{" "}
            {BRAND} is not a medical provider. Before making a significant change to how you live,
            particularly if you are managing a condition, talk to a doctor.
          </Disclaimer>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
