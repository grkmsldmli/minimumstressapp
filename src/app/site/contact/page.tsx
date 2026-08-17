import type { Metadata } from "next";

import { PageShell, Section } from "@/components/site/page-shell";
import { Reveal } from "@/components/site/reveal";
import { BRAND, LEGAL_ENTITY, SUPPORT_EMAIL, WEBSITE } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * One address, and what to put in the message.
 *
 * No contact form. A form here would be a worse version of an email — it drops
 * whatever somebody wrote if the request fails, it cannot be replied to from a
 * phone, and it hides the address from anybody who would rather use their own
 * mail. There is one inbox and it is a real one, so the page says so.
 *
 * What it adds instead is the thing that actually shortens a support thread:
 * saying which details to include, per kind of problem. Most of the back and
 * forth on a marketplace is one side asking which booking somebody means.
 */

export const metadata: Metadata = {
  title: "Contact",
  description: `How to reach ${BRAND} — one address, read by a person, and what to include.`,
  alternates: { canonical: `${WEBSITE}/contact` },
};

const WHAT_TO_SAY = [
  {
    about: "A booking",
    include: "The date and time of the session and the name of the room. That is enough to find it.",
  },
  {
    about: "A charge or a refund",
    include:
      "The date of the booking and the last four digits of the card. Never the full number — nobody here needs it and no email should carry it.",
  },
  {
    about: "Listing a space",
    include:
      "Which town it is in and what kind of room. If it is about a listing already made, its name.",
  },
  {
    about: "Something that went wrong in a room",
    include:
      "What happened and when, and whether anybody was hurt. If somebody is in danger, that is a call to emergency services, not an email to us.",
  },
];

export default function ContactPage() {
  return (
    <PageShell
      eyebrow="Contact"
      title={<>One address, read by a person.</>}
      standfirst="There is no contact form and no ticket number. Write, and somebody answers."
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
            Hosts, practitioners, press and anything else. It is one inbox rather than four that
            look different and reach the same place.
          </p>
        </div>
      </Reveal>

      <Section title="What to put in it">
        <p>
          Most of the back and forth on something like this is us asking which booking somebody
          means. Including this at the start usually removes a day.
        </p>

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
          <strong style={{ color: COLOUR.ink }}>Anything urgent about somebody&rsquo;s safety</strong>{" "}
          is 911, not an inbox. Tell us afterwards; do not wait for us first.
        </p>
        <p>
          <strong style={{ color: COLOUR.ink }}>Card numbers, passwords and codes</strong> should
          never be in an email to anybody, including us. We will never ask for them, and a message
          that does is not from us.
        </p>
      </Section>

      <Section title="Who you are writing to">
        <p>
          {LEGAL_ENTITY}, operating as {BRAND}. We are a small team in California, which is both
          why an email reaches a person and why it is sometimes the next morning rather than the
          same hour.
        </p>
      </Section>
    </PageShell>
  );
}
