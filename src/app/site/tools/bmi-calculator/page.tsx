import Link from "next/link";
import type { Metadata } from "next";

import { BmiTool } from "@/components/site/bmi-tool";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { BRAND } from "@/lib/company";

export const metadata: Metadata = {
  title: "BMI Calculator",
  description:
    "Work out your BMI and the healthy weight range for your height — with a plain account " +
    "of what the number can and cannot tell you.",
};

export default function BmiPage() {
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
            What does your
            <br />
            <em className="italic" style={{ color: "#0EA5E9" }}>
              BMI actually mean?
            </em>
          </h1>

          <p className="mt-5 max-w-xl text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            BMI is your weight divided by your height squared. That is the whole calculation. It is
            useful for comparing populations and blunt for describing a person — it cannot tell
            muscle from fat, and it does not know your age, your build, or how you feel.
          </p>

          <div className="mt-10">
            <BmiTool />
          </div>

          {/*
            Said in the open rather than folded behind a grey "Disclaimer &
            Important Information" button, which is where the Shopify page put it.
            Somebody who has just been handed a number about their own body is
            owed the limits of it in the same breath, not one click away.
          */}
          <p
            className="mt-12 rounded-2xl p-6 text-[14px] leading-[1.75]"
            style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
          >
            This is information, not medical advice, and not a diagnosis. BMI is a screening ratio
            — athletes read high, and it says nothing about where weight sits on the body, which is
            the part that matters most. {BRAND} is not a medical provider. If you want to know what
            your weight means for your health, that is a conversation with a doctor.
          </p>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
