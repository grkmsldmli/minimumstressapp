import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { TdeeTool } from "@/components/site/tdee-tool";
import { BRAND } from "@/lib/company";

export const metadata: Metadata = {
  title: "TDEE Calculator",
  description:
    "Your total daily energy expenditure from the Mifflin-St Jeor equation, with a calorie " +
    "target and macros for your goal.",
};

export default function TdeePage() {
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
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            How many calories does
            <br />
            <em className="italic" style={{ color: "#E8502A" }}>
              your body actually need?
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Your total daily energy expenditure, from the Mifflin-St Jeor equation — what you burn
            at rest, plus what your activity adds, adjusted for what you are trying to do.
          </p>

          <div className="mt-10">
            <TdeeTool />
          </div>

          <p
            className="mt-12 rounded-2xl p-6 text-[14px] leading-[1.75]"
            style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
          >
            This is information, not medical or dietary advice. The equation is a population
            average and real needs vary with genetics, medication, thyroid function and how much
            you move without counting it. {BRAND} is not a medical provider. If you are managing a
            health condition, or eating considerably less than this, that is a conversation with a
            doctor or a registered dietitian.
          </p>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
