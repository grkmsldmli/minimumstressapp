import type { Metadata } from "next";

import { PageShell, Section } from "@/components/site/page-shell";
import { Reveal } from "@/components/site/reveal";
import { BRAND, LEGAL_ENTITY, SUPPORT_EMAIL, WEBSITE } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * One address, and what to put in the message.
 *
 * No contact form: it loses what somebody wrote when a request fails, cannot
 * be replied to from a phone, and hides the address from anybody who would
 * rather use their own mail.
 */

export const metadata: Metadata = {
  title: "Contact",
  description: `How to reach ${BRAND}. One address, read by a person.`,
  alternates: { canonical: `${WEBSITE}/contact` },
};

const WHAT_TO_SAY = [
  {
    about: "A booking",
    include: "The date, the time and the name of the room.",
  },
  {
    about: "A charge or a refund",
    include:
      "The date of the booking and the last four digits of your card. Never the full number.",
  },
  {
    about: "Listing your space",
    include: "Which town it is in and what kind of room. If it is already listed, its name.",
  },
  {
    about: "Something that went wrong in a room",
    include:
      "What happened and when, and whether anybody was hurt. If someone is in danger, call 911 first.",
  },
];

export default function ContactPage() {
  return (
    <PageShell
      eyebrow="Contact"
      title={<>Talk to a person.</>}
      standfirst="No forms, no ticket numbers. Write to us and someone answers."
    >
      <Reveal>
        <div
          className="mt-10 rounded-2xl p-7"
          style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
        >
          <p className={TYPE.eyebrow} style={{ color: COLOUR.muted }}>
            Email
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-2 block text-[26px] leading-tight underline underline-offset-4 sm:text-[30px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
          >
            {SUPPORT_EMAIL}
          </a>
          <p className={`mt-4 ${TYPE.small}`} style={{ color: COLOUR.body }}>
            Hosts, practitioners, press — one inbox for all of it.
          </p>
        </div>
      </Reveal>

      <Section title="What to include">
        <p>Adding this at the start usually saves a day of back and forth.</p>

        <dl className="space-y-5 pt-2">
          {WHAT_TO_SAY.map((item) => (
            <div key={item.about}>
              <dt className={`font-medium ${TYPE.body}`} style={{ color: COLOUR.ink }}>
                {item.about}
              </dt>
              <dd className={`mt-1.5 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                {item.include}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Two things to send elsewhere">
        <p>
          <strong style={{ color: COLOUR.ink }}>Anything urgent about someone&rsquo;s safety</strong>{" "}
          is 911, not email. Tell us afterwards.
        </p>
        <p>
          <strong style={{ color: COLOUR.ink }}>Card numbers, passwords and codes</strong> should
          never go in an email to anyone, including us. We will never ask for them.
        </p>
      </Section>

      <Section title="Who you are writing to">
        <p>
          {LEGAL_ENTITY}, trading as {BRAND}. We are a small team in California — which is why an
          email reaches a person, and why it is sometimes the next morning.
        </p>
      </Section>
    </PageShell>
  );
}
