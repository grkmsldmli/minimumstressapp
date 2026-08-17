import type { Metadata } from "next";

import { Onward, PageShell, QA, Section } from "@/components/site/page-shell";
import { BRAND, WEBSITE } from "@/lib/company";
import { CLAIM_WINDOW_HOURS } from "@/lib/claims";
import { FREE_CANCEL_WINDOW_MS } from "@/lib/money";

/**
 * What we check, who can get in, and what happens if something goes wrong.
 *
 * Every claim here names something the product actually does. Nothing about
 * screening people, because we do not screen people.
 */

export const metadata: Metadata = {
  title: "Trust & Safety",
  description:
    "What we check before a room is listed, who can get in, what happens if something is " +
    "damaged, and what we do not do.",
  alternates: { canonical: `${WEBSITE}/trust` },
};

const CANCEL_HOURS = FREE_CANCEL_WINDOW_MS / 3_600_000;

export default function TrustPage() {
  return (
    <PageShell
      eyebrow="Trust & safety"
      title={<>You are letting a stranger in. Here is what we do about that.</>}
      standfirst="Every room is checked, every booking is paid for, and everyone who books carries their own insurance."
    >
      <Section title="Before a room goes live">
        <p>
          We look at every listing ourselves, along with the lease or ownership document behind it.
          If the paperwork does not show a right to let the room, it is not listed.
        </p>
        <p>If a host moves to a new address, the listing goes back for the same check.</p>
      </Section>

      <Section title="Who can get in, and when">
        <p>
          The address is on the listing, so you always know where you are going before you book.
          Most rooms here are studios whose address is public anyway.
        </p>
        <p>
          Getting inside is separate. What you need to enter reaches the practitioner who paid for
          that hour, shortly before it starts, and nobody else. Cancel and it disappears.
        </p>
      </Section>

      <Section title="If something is damaged">
        <p>
          Hosts have {CLAIM_WINDOW_HOURS} hours after a session to tell us. We hold that
          session&rsquo;s payout while we look into it.
        </p>
        <p>
          Everyone who books confirms they carry their own insurance first. {BRAND} is a booking
          platform, not an insurer.
        </p>
      </Section>

      <Section title="Cancelling">
        <p>
          Cancel {CANCEL_HOURS} hours or more before your session and you are not charged. Inside
          that window the booking stands, because the host kept the hour free for you.
        </p>
        <p>If a host cancels on you, you are refunded in full, whenever it happens.</p>
      </Section>

      <Section title="Reviews, both ways">
        <p>
          You review the room and the host reviews the session. Neither of you sees the other&rsquo;s
          review until both are written, which is what makes them worth reading.
        </p>
      </Section>

      <Section title="What we do not do">
        <p>
          We do not check qualifications or licences. Every professional here is responsible for
          holding what their work requires, and for their own clients.
        </p>
        <p>{BRAND} does not own the rooms and provides no medical or health service.</p>
      </Section>

      <Section title="Common questions">
        <dl className="space-y-6">
          <QA q="Who is coming into my space?">
            Someone with an account who has accepted the terms, confirmed their insurance and paid
            for the hour. You can see who booked and message them beforehand.
          </QA>
          <QA q="What if they do not turn up?">
            They are still charged. Payment is taken when the booking is made.
          </QA>
          <QA q="What if a room is not as described?">Tell us, and say so in your review.</QA>
        </dl>

        <Onward href="/for-hosts">How hosting works</Onward>
      </Section>
    </PageShell>
  );
}
