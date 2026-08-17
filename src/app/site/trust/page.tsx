import type { Metadata } from "next";

import { Onward, PageShell, QA, Section } from "@/components/site/page-shell";
import { BRAND, WEBSITE } from "@/lib/company";
import { CLAIM_WINDOW_HOURS } from "@/lib/claims";
import { FREE_CANCEL_WINDOW_MS } from "@/lib/money";

/**
 * What happens when it goes wrong, which is the only thing this page is about.
 *
 * A trust page is usually a wall of reassurance with nothing underneath it —
 * badges, the word "verified", a promise about safety that names no mechanism.
 * That is worse than saying nothing, because the reader who is worried is
 * exactly the reader who notices there is no answer in it.
 *
 * So every claim here names the thing that makes it true, and each one is
 * something the code actually does: a lease checked before a listing goes
 * live, an access code that will not appear without a paid booking, a claim
 * window that holds the payout while it is open, an address that is published
 * and entry instructions that are not. Nothing about screening people, because
 * we do not screen people, and a page that implied we did would be the most
 * dangerous sentence on the site.
 */

export const metadata: Metadata = {
  title: "Trust & Safety",
  description:
    "What we check before a room is listed, who gets the door code and when, what happens if " +
    "something is damaged, and what we do not do.",
  alternates: { canonical: `${WEBSITE}/trust` },
};

const CANCEL_HOURS = FREE_CANCEL_WINDOW_MS / 3_600_000;

export default function TrustPage() {
  return (
    <PageShell
      eyebrow="Trust & safety"
      title={<>What happens when it goes wrong.</>}
      standfirst="Every line here names the mechanism behind it. A promise with no mechanism is the part of a page like this worth nothing."
    >
      <Section title="Before a room is listed">
        <p>
          A listing does not go live because somebody filled a form in. We look at it and at the
          lease or ownership document behind it, and a room whose paperwork does not show a right
          to sublet does not appear. That check is why the document is asked for at all.
        </p>
        <p>
          Moving a listing to a different address sends it back for the same check. The verified
          thing was a specific room at a specific address, and once either changes what was
          verified is no longer what is listed.
        </p>
      </Section>

      <Section title="Who can get in, and when">
        <p>
          The street address is on the listing. Almost every room here is a studio whose address is
          already on its own website and on a map, and withholding it protected nothing while
          costing a practitioner the single fact they judge a room by.
        </p>
        <p>
          How to get in is a different thing. Entry instructions and the access code appear{" "}
          {CANCEL_HOURS} hours before the session and only for a booking that is paid for and still
          standing — not for an abandoned checkout, and not for a booking either side has
          cancelled. &ldquo;386 Convention Way&rdquo; tells somebody where the building is. &ldquo;Side
          door, keypad 4021&rdquo; tells them how to get inside it, and that belongs to whoever paid
          for the hour.
        </p>
      </Section>

      <Section title="If something is damaged">
        <p>
          A host can raise a claim for {CLAIM_WINDOW_HOURS} hours after a session, and the payout
          for that session is held while it is open rather than paid out and chased afterwards.
        </p>
        <p>
          Behind that, every practitioner booking here confirms they hold their own insurance for
          the work they do. That is the backstop, and it is why it is a condition rather than a
          suggestion — {BRAND} is a booking platform, not an insurer.
        </p>
      </Section>

      <Section title="Cancelling">
        <p>
          Cancel more than {CANCEL_HOURS} hours before a session and the charge is voided: the
          money never leaves the card rather than leaving and returning a week later. Inside that
          window it is charged, which is what makes an hour a host has held open worth holding.
        </p>
        <p>
          A host cancelling on somebody takes the access code with it, and the practitioner is
          refunded in full whenever it happens.
        </p>
      </Section>

      <Section title="Reviews, in both directions">
        <p>
          A practitioner reviews the room and the host reviews the session. Both are visible, and
          neither can be edited into agreement afterwards — which is what makes either worth
          reading. Somebody who leaves rooms badly carries that with them, and so does a room that
          was not as described.
        </p>
      </Section>

      <Section title="What we do not do">
        <p>
          We do not vet practitioners&rsquo; qualifications, licences or registrations. They are
          responsible for holding whatever their work requires, and for their own clients. We check
          that a room may be let and that a booking is paid for; we are not a regulator and saying
          otherwise here would be the most dangerous sentence on the site.
        </p>
        <p>
          {BRAND} does not own or control the rooms listed, and provides no medical, therapeutic or
          health service of any kind.
        </p>
      </Section>

      <Section title="The questions underneath all that">
        <dl className="space-y-6">
          <QA q="Who is coming into my space?">
            Somebody with an account, who has accepted the terms and confirmed their own insurance,
            whose card has been charged for the hour. You see who booked and can message them
            before they arrive.
          </QA>
          <QA q="Can somebody book and then just not turn up?">
            They can, and they are charged for it — the money is taken at booking, not at the door.
          </QA>
          <QA q="What if a room is not what the listing said?">
            Tell us, and say so in the review. A listing that misdescribes a room is a listing
            problem, and the review is the part that reaches the next person.
          </QA>
        </dl>

        <Onward href="/for-hosts">How hosting works</Onward>
      </Section>
    </PageShell>
  );
}
