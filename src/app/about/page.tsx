import type { Metadata } from "next";
import Link from "next/link";

import { BRAND, LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/company";
import { SERVICE_FEE_RATE } from "@/lib/money";
import { CATEGORIES } from "@/lib/taxonomy";

/**
 * What this is, for somebody who has not signed in and should not have to.
 *
 * The app's own front door is the app: a breathing exercise and a Begin
 * button. That is right for a practitioner opening it for the tenth time and
 * wrong for everybody else — a studio owner deciding whether this is a real
 * company, and the reviewer at Google who refused to verify our consent screen
 * on exactly this ground ("your home page does not explain the purpose of your
 * app"). Until that verification passes, the sign-in screen names a random
 * Supabase subdomain instead of us, which is the first thing a new host sees.
 *
 * Server-rendered with no account required, because both readers arrive with
 * neither a session nor patience.
 *
 * Every number here is read from the constant the app charges on, not typed
 * out. A landing page quoting a fee the product no longer takes is worse than
 * one quoting no fee at all.
 */
export const metadata: Metadata = {
  title: "About",
  description: `${BRAND} is a marketplace for private rooms by the hour — movement, coaching, meditation and healing.`,
  alternates: { canonical: "/about" },
};

const STEPS = [
  {
    title: "Find a room",
    body: "Search by what you practise and where you are. Listings show the room, the rate, the address, what is in it and what it suits — everything except how to get through the door.",
  },
  {
    title: "Book the hour",
    body: "Pick a time inside the host's open hours and pay when you book. The money is held, not sent on, until the session has actually happened.",
  },
  {
    title: "Let yourself in",
    body: "The entry instructions and the door code are released to you 24 hours before your session, and to nobody else.",
  },
  {
    title: "Both sides review",
    body: "Afterwards you each write a review. Neither is visible until you have both written, or 14 days pass — so nobody is answering a review they have already read.",
  },
];

export default function About() {
  return (
    <main className="min-h-full bg-white">
      <header
        className="px-6 py-14 relative overflow-hidden"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
      >
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          {/*
            The name is the heading, not a label above one.

            It was set as a small tracking-wide caption with the tagline in the
            h1, which reads well and failed the one test this page has to pass:
            Google's reviewer compares the app name on the consent screen with
            the name on this page, and "Minimum Stress" in 12px at 60% opacity
            under a larger, different sentence is a name they can miss. It is
            also the only heading a screen reader announces first.
          */}
          <h1 className="font-display italic font-semibold text-white text-[38px] leading-tight">
            {BRAND}
          </h1>
          <p className="font-body font-medium text-[18px] text-white/85 mt-3">
            Private rooms by the hour.
          </p>
          <p className="font-body font-normal text-[16px] text-white/75 mt-4 leading-relaxed">
            {BRAND} is a marketplace where wellness practitioners rent a room for an hour, and the
            people who own those rooms fill the hours they are not using. Movement, coaching,
            meditation and healing.
          </p>
        </div>
      </header>

      <div className="px-6 py-12">
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          <Section title="Who it is for">
            <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted">
              <strong className="text-navy">Practitioners</strong> who see clients but do not want
              a lease. A yoga teacher with four students on a Tuesday needs a room for ninety
              minutes, not a studio for a year.
            </p>
            <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted mt-3">
              <strong className="text-navy">Hosts</strong> with a room that sits empty half the
              week — a studio, a treatment room, a quiet office. They set their own hours and their
              own rate.
            </p>
          </Section>

          <Section title="How a booking works">
            <ol className="flex flex-col gap-5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex items-start gap-4">
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-body font-semibold text-[13px] text-white"
                    style={{ backgroundColor: "#3B9BE8" }}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-body font-medium text-[15px] text-navy">{step.title}</p>
                    <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted mt-1">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Rooms on the platform">
            <div className="flex flex-col gap-3">
              {CATEGORIES.map((category) => (
                <div
                  key={category.key}
                  className="rounded-2xl px-4 py-3.5"
                  style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
                >
                  <p className="font-body font-medium text-[15px] text-navy">{category.roomType}</p>
                  <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-soft mt-0.5">
                    {category.specialties.join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="What it costs">
            <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted">
              A host sets their hourly rate and receives all of it. Our service fee is{" "}
              {Math.round(SERVICE_FEE_RATE * 100)}% and is added on top for the practitioner — it is
              never taken out of what a host is owed.
            </p>
            <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted mt-3">
              Cancel 24 or more hours ahead and you are refunded. If a host cancels on you, you are
              refunded in full, automatically, including the card processing fee — you did not cause
              it and you do not pay for it.
            </p>
          </Section>

          <Section title="What is public, and what is not">
            <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted">
              The address is on the listing — it is already on a map and on the studio&rsquo;s own
              website, and hiding it left a practitioner booking an afternoon somewhere they could
              not place. How to get in is the part that is not public: the entry instructions and
              any door code go only to whoever paid for that hour, 24 hours before it starts. Hosts
              hand us a lease or ownership document before a room goes live; those are read by us
              and shown to nobody.
            </p>
          </Section>

          <div className="h-px my-9" style={{ backgroundColor: "#E7EEF6" }} />

          <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-soft">
            {BRAND} is operated by {LEGAL_ENTITY}. Write to us at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sky-text">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>

          <nav className="flex flex-wrap gap-x-5 gap-y-2 mt-5">
            <Link href="/" className="font-body text-[13.5px] text-sky-text">
              Open the app
            </Link>
            <Link href="/terms" className="font-body text-[13.5px] text-sky-text">
              Terms of Service
            </Link>
            <Link href="/privacy" className="font-body text-[13.5px] text-sky-text">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-display italic font-semibold text-[22px] text-navy mb-4">{title}</h2>
      {children}
    </section>
  );
}
