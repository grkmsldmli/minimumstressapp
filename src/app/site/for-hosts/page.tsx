import Image from "next/image";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { APP_URL, BRAND } from "@/lib/company";

/**
 * Where the old application forms land.
 *
 * Shopify had three of them — a provider form, a partner form, and a second
 * copy of the provider form — each asking for photographs, availability,
 * prices and a signature by email, then telling somebody a human would review
 * it. That queue is the product now: a host lists a room in the app in about
 * ten minutes and sets their own hours and rate. So this page's job is to say
 * that and get out of the way, not to collect the same twenty fields again.
 */

export const metadata: Metadata = {
  title: "List your room",
  description:
    "If you have a treatment room, a studio, or a spare consulting room, the hours you are " +
    "not in it can earn. You set the rate and the hours.",
};

const STEPS = [
  {
    n: "01",
    title: "List the room",
    body: "Photographs, the address, your rate, and the hours you are happy for it to be used. About ten minutes.",
  },
  {
    n: "02",
    title: "We check it",
    body: "We look at the listing and the lease or ownership document before it goes live. Usually a day.",
  },
  {
    n: "03",
    title: "It earns",
    body: "Bookings arrive only inside your hours. Stripe pays your bank after each session.",
  },
];

export default function ForHostsPage() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 pb-16 pt-8 lg:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#0EA5E9" }}>
              For hosts
            </p>

            <h1
              className="mt-4 text-[40px] leading-[1.08] sm:text-[48px]"
              style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
            >
              The hours you are
              <br />
              <em className="italic" style={{ color: "#0EA5E9" }}>
                not in the room.
              </em>
            </h1>

            <p className="mt-6 max-w-md text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
              A treatment room, a studio, a spare consulting room — if you are already paying for
              it, the hours you do not use are worth something. You set the rate and the hours,
              and nobody arrives outside them.
            </p>

            <a
              href={APP_URL}
              className="mt-8 inline-block rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
              style={{ backgroundColor: "#0F2F55" }}
            >
              List your room
            </a>
          </div>

          <div className="overflow-hidden rounded-3xl">
            <Image
              src="/photos/practitioner-setting-up.webp"
              alt="A practitioner laying folded towels on a treatment table before a session."
              width={1672}
              height={941}
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="h-full w-full object-cover"
            />
          </div>
        </section>

        <section className="border-y py-16" style={{ borderColor: "#eef2f6", backgroundColor: "#f8fbfd" }}>
          <div className="mx-auto grid max-w-5xl gap-6 px-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n}>
                <span className="text-[12px] font-bold tracking-[0.1em]" style={{ color: "#0EA5E9" }}>
                  {step.n}
                </span>
                <h2
                  className="mt-2 text-[20px]"
                  style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
                >
                  {step.title}
                </h2>
                <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/*
          The questions a host actually asks before listing, answered without
          being asked. Every one of them is about risk, which is the only
          reason somebody hesitates to let a stranger into their room.
        */}
        <section className="mx-auto max-w-3xl px-6 py-16">
          <h2
            className="text-[28px] leading-tight"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            What we do about the obvious worries.
          </h2>

          <dl className="mt-8 space-y-7 text-[15.5px] leading-[1.8]" style={{ color: "#5f6673" }}>
            <div>
              <dt className="font-medium" style={{ color: "#0F2F55" }}>
                Who is coming into my room?
              </dt>
              <dd className="mt-1">
                Practitioners who have accepted the terms and confirmed they carry their own
                insurance. You see who booked, and you can message them before the session.
              </dd>
            </div>

            <div>
              <dt className="font-medium" style={{ color: "#0F2F55" }}>
                What if something is damaged?
              </dt>
              <dd className="mt-1">
                You can raise a claim for 48 hours after a session, and we hold the payout while
                it is open. Their insurance is the backstop, which is why we require it.
              </dd>
            </div>

            <div>
              <dt className="font-medium" style={{ color: "#0F2F55" }}>
                Can somebody book when I am using the room?
              </dt>
              <dd className="mt-1">
                No. The room is only bookable inside the hours you set, and you can change them
                whenever you like.
              </dd>
            </div>

            <div>
              <dt className="font-medium" style={{ color: "#0F2F55" }}>
                When am I paid?
              </dt>
              <dd className="mt-1">
                After each session, to your own bank account, through Stripe. {BRAND} never holds
                your money and never sees your bank details.
              </dd>
            </div>
          </dl>

          <a
            href={APP_URL}
            className="mt-10 inline-block rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            List your room
          </a>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
