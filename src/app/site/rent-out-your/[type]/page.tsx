import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { EarningsCalculator } from "@/components/site/earnings-calculator";
import { APP_URL, BRAND, WEBSITE } from "@/lib/company";
import { hostPageFor, hostPages } from "@/lib/host-pages";

/**
 * One page per kind of room, for the person who owns one.
 *
 * These are the first pages here written to be found rather than navigated to,
 * and they are first for a reason that has nothing to do with them being easy:
 * they are the only ones that work with no listings. Every page built around
 * "rooms in San Mateo" is empty today and correctly refuses to be indexed,
 * while a page about renting out a pilates studio is complete the day it ships
 * — and ranking takes months whenever it starts, so it should start now.
 *
 * What they bring back is supply, which is what makes the city pages possible.
 * That is the whole argument for this order.
 */

export function generateStaticParams() {
  return hostPages().map((page) => ({ type: page.type.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const page = hostPageFor((await params).type);
  if (!page) return {};

  return {
    title: page.title,
    description: page.standfirst,
    alternates: { canonical: `${WEBSITE}/rent-out-your/${page.type.slug}` },
    openGraph: {
      title: page.title,
      description: page.standfirst,
      url: `${WEBSITE}/rent-out-your/${page.type.slug}`,
      type: "website",
    },
  };
}

export default async function RentOutYourPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const page = hostPageFor((await params).type);
  if (!page) notFound();

  const others = hostPages().filter((other) => other.type.slug !== page.type.slug);

  return (
    <>
      <SiteHeader width="narrow" />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-4">
        <Link href="/for-hosts" className="text-[14px]" style={{ color: "#0EA5E9" }}>
          ← For hosts
        </Link>

        <h1
          className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          {page.heading}
        </h1>

        <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
          {page.standfirst}
        </p>

        {/*
          The calculator sits above the explanation on purpose. The host already
          knows what their room is; what they have never done is put a number on
          the hours it is empty, and that number is what makes the rest of the
          page worth reading.
        */}
        <div className="mt-10">
          <EarningsCalculator roomLabel={page.type.label} />
        </div>

        <h2
          className="mt-14 text-[26px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Who rents a {page.type.label.toLowerCase()}
        </h2>
        <p className="mt-4 text-[16px] leading-[1.8]" style={{ color: "#5f6673" }}>
          {page.whoRents}
        </p>

        <h2
          className="mt-12 text-[26px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          What makes one bookable
        </h2>
        <ul className="mt-4 space-y-3">
          {page.whatItNeeds.map((item) => (
            <li
              key={item}
              className="flex gap-3 text-[15.5px] leading-[1.75]"
              style={{ color: "#5f6673" }}
            >
              <span
                className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: "#0EA5E9" }}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div
          className="mt-12 rounded-2xl p-6"
          style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
        >
          <h2 className="text-[19px] leading-snug" style={{ color: "#0F2F55" }}>
            {page.concern.question}
          </h2>
          <p className="mt-3 text-[15.5px] leading-[1.8]" style={{ color: "#5f6673" }}>
            {page.concern.answer}
          </p>
        </div>

        <h2
          className="mt-14 text-[26px] leading-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          How it works
        </h2>
        <ol className="mt-4 space-y-4">
          {[
            "List the room — photographs, the address, your rate, and the hours you are happy for it to be used. About ten minutes.",
            "We check the listing and the lease or ownership document before it goes live. Usually a day.",
            "Bookings arrive only inside the hours you opened. Stripe pays your bank after each session.",
          ].map((step, index) => (
            <li key={step} className="flex gap-4">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-medium"
                style={{ backgroundColor: "#f0f9ff", color: "#0EA5E9" }}
              >
                {index + 1}
              </span>
              <span className="text-[15.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
                {step}
              </span>
            </li>
          ))}
        </ol>

        <a
          href={`${APP_URL}?list=1`}
          className="mt-10 inline-block rounded-full px-8 py-4 text-[15px] font-medium text-white"
          style={{ backgroundColor: "#0F2F55" }}
        >
          List your {page.type.label.toLowerCase()}
        </a>

        {/*
          Real links between the pages, not a footer dump. A host with a
          treatment room often has a room that would also suit reiki, and this
          is how somebody who landed on the wrong one finds the right one — and
          how a crawler finds the other nine at all.
        */}
        <h2 className="mt-16 text-[14px] font-medium" style={{ color: "#0F2F55" }}>
          Other rooms people are looking for
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {others.map((other) => (
            <Link
              key={other.type.slug}
              href={`/rent-out-your/${other.type.slug}`}
              className="rounded-xl p-4"
              style={{ border: "1px solid #e7eef6" }}
            >
              <span className="block text-[15px]" style={{ color: "#0F2F55" }}>
                {other.type.label}
              </span>
              <span className="mt-1 block text-[13.5px] leading-[1.6]" style={{ color: "#8a94a3" }}>
                {other.type.blurb}
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-12 text-[13.5px] leading-[1.7]" style={{ color: "#8a94a3" }}>
          {BRAND} is a booking platform. It does not own or control the spaces listed. Hosts are
          responsible for having the right to let their room, and practitioners for their own
          qualifications, registration and insurance.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
