import Link from "next/link";
import type { Metadata } from "next";

import { BodyFatTool } from "@/components/site/body-fat-tool";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { BRAND } from "@/lib/company";
import { Disclaimer } from "@/components/site/disclaimer";

export const metadata: Metadata = {
  title: "Body Fat Calculator",
  description:
    "Estimate body fat percentage, lean mass and fat mass from tape measurements, using the " +
    "U.S. Navy circumference method.",
};

export default function BodyFatPage() {
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
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Estimate your
            <br />
            <em className="italic" style={{ color: "#1D6FA8" }}>
              body fat percentage.
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            BMI cannot tell muscle from fat. This uses circumference measurements — the U.S. Navy
            method — to estimate body fat, lean mass and fat mass separately. You will need a tape
            measure.
          </p>

          <div className="mt-10">
            <BodyFatTool />
          </div>

          <Disclaimer>
            This is information, not medical advice. Circumference methods are estimates and they
            run several points either side of a DEXA scan, particularly at the extremes and for
            people carrying a lot of muscle. {BRAND} is not a medical provider.
          </Disclaimer>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
