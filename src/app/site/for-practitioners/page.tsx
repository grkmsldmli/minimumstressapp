import Image from "next/image";
import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { RequestSpace } from "@/components/site/request-space";
import { APP_URL } from "@/lib/company";

/**
 * The practitioner-side equivalent of /for-hosts.
 *
 * The other page tells somebody with a room how the hours it sits empty can
 * earn. This one tells somebody with clients of their own that they can book a
 * room by the hour without signing a lease for it. Same chrome, same CTA
 * system, same measure — the two sides of the marketplace read as one site.
 *
 * The pitch is deliberately narrow to what the product actually does: it does
 * not supply clients, certify anybody, or promise a room will be free. It
 * carries people to the app, which is where every listing, price and hour now
 * lives.
 */

export const metadata: Metadata = {
  title: "Flexible Space for Wellness Practitioners",
  description:
    "Bring your own clients and book professional wellness and movement space by the hour — " +
    "without a long-term lease.",
};

const BENEFITS = [
  {
    title: "Book by the hour",
    body: "Pay for the time you actually need.",
  },
  {
    title: "Bring your own clients",
    body: "Use the space for your existing sessions, students, or participants.",
  },
  {
    title: "Stay flexible",
    body: "Book a single session or return to the same space regularly.",
  },
];

/**
 * The uses the current inventory is set up for — movement, private practice,
 * and small-group work. Shown as plain labels, not a promise that every one is
 * live in every town; that is what the search itself answers.
 */
const USES = [
  "Pilates",
  "Yoga",
  "Movement",
  "Coaching & consultation",
  "Meditation",
  "Breathwork",
  "Massage & bodywork",
  "Small groups",
  "Classes",
  "Workshops",
];

const STEPS = [
  {
    n: "01",
    title: "Find a space",
    body: "Search by area and category, and see what fits your practice.",
  },
  {
    n: "02",
    title: "Choose your time",
    body: "Book the hour you need, inside the hours the host has opened.",
  },
  {
    n: "03",
    title: "Complete what you need to book",
    body: "Complete identity, liability insurance, and professional proof before your first booking.",
  },
  {
    n: "04",
    title: "Bring your client and run your session",
    body: "Arrive, do your work, and the room is yours for the time you booked.",
  },
];

export default function ForPractitionersPage() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-8 lg:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#0EA5E9" }}>
              For practitioners
            </p>

            <h1
              className="mt-4 text-[40px] leading-[1.08] sm:text-[48px]"
              style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
            >
              Bring your clients.
              <br />
              <em className="italic" style={{ color: "#0EA5E9" }}>
                Book only the space you need.
              </em>
            </h1>

            <p className="mt-6 max-w-md text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
              Find professional wellness and movement spaces by the hour — without committing to a
              lease.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href={APP_URL}
                className="inline-block rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
                style={{ backgroundColor: "#0F2F55" }}
              >
                Browse spaces
              </a>
              <a
                href="#how-it-works"
                className="inline-block text-[15px] font-medium"
                style={{ color: "#0A6390" }}
              >
                See how it works
              </a>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl">
            <Image
              src="/photos/practitioner-session.webp"
              alt="A practitioner working with a client in a calm, light-filled private room."
              width={1600}
              height={1067}
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="h-full w-full object-cover"
            />
          </div>
        </section>

        <section className="border-y py-16" style={{ borderColor: "#eef2f6", backgroundColor: "#f8fbfd" }}>
          <div className="mx-auto grid max-w-6xl gap-6 px-6 md:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title}>
                <h2
                  className="text-[20px]"
                  style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
                >
                  {benefit.title}
                </h2>
                <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
                  {benefit.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/*
          Who actually books here. Independent professionals bringing their own
          people — not clients we supply, which we do not. The labels are the
          uses the inventory is built for; the search says which are live where.
        */}
        <section className="mx-auto max-w-6xl px-6 pt-16">
          <h2
            className="text-[26px] leading-tight"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Who books on Minimum Stress
          </h2>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Independent professionals who bring their own clients, students, or participants, and
            need a room for the hour rather than a lease for the year.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {USES.map((use) => (
              <span
                key={use}
                className="rounded-full px-4 py-2 text-[14px]"
                style={{ border: "1px solid #e7eef6", color: "#0F2F55" }}
              >
                {use}
              </span>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl px-6 pt-16">
          <h2
            className="text-[26px] leading-tight"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            How it works
          </h2>

          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <div key={step.n}>
                <span className="text-[12px] font-bold tracking-[0.1em]" style={{ color: "#0EA5E9" }}>
                  {step.n}
                </span>
                <h3
                  className="mt-2 text-[19px] leading-[1.3]"
                  style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
                >
                  {step.title}
                </h3>
                <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
                  {step.body}
                </p>
              </div>
            ))}
          </div>

          {/*
            The rule is Step 3 above, stated once. Browsing is open; the checks
            are a gate on booking, not a certification we award — and there is no
            promise about how long they take, because we do not control that.
          */}
          <p className="mt-8 max-w-2xl text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
            You can browse before you complete them.
          </p>
        </section>

        {/*
          The empty-search answer, on the acquisition page as well as inside the
          app: somewhere to leave a town when the right room is not listed yet.
          Reuses the same component and the same /api/spaces/request behind it.
        */}
        <section className="mx-auto max-w-3xl px-6 pt-16">
          <h2
            className="text-[26px] leading-tight"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Don&rsquo;t see the right space yet?
          </h2>
          <p className="mt-3 text-[15.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            Tell us where you practice. We use it to decide where to add spaces next.
          </p>

          <Suspense fallback={null}>
            <RequestSpace />
          </Suspense>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-20">
          <p
            className="text-[24px] leading-[1.35] sm:text-[28px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Your client already booked the hour. You don&rsquo;t need the studio for the rest of the
            week.
          </p>
          <a
            href={APP_URL}
            className="mt-8 inline-block rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            Browse spaces
          </a>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
