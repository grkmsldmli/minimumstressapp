import type { Metadata } from "next";

import { PageShell, Section } from "@/components/site/page-shell";
import { Reveal } from "@/components/site/reveal";
import { APP_URL, BRAND, LEGAL_ENTITY, SUPPORT_EMAIL, WEBSITE } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * The Californian "Your Privacy Choices" page, answered honestly.
 *
 * The link is a legal fixture for a company operating here, and the usual
 * version of the page is a dark pattern: a toggle that appears to do something,
 * under a heading implying there was something to stop. This one says what is
 * true — nothing is sold and nothing is shared for cross-context advertising,
 * which the privacy policy in the app already commits to — so there is no
 * opt-out because there is no opt-in.
 *
 * What replaces the toggle is the part that does work: the rights that apply
 * whatever a company sells, and what deleting an account actually does. That
 * last one is described from lib/account-deletion rather than in the abstract,
 * because "we will delete your data" is the sentence everybody writes and
 * almost nobody means literally — completed bookings survive here, and a page
 * that implied otherwise would be lying about a financial record.
 *
 * The authority is the policy in the app, not this page. It is where somebody
 * agrees to it and where the version they accepted is recorded; a second copy
 * out here would be a second policy that can drift from the one people signed.
 */

export const metadata: Metadata = {
  title: "Your Privacy Choices",
  description:
    `${BRAND} does not sell personal information or share it for cross-context advertising. ` +
    "What that means, and how to see or delete what we hold.",
  alternates: { canonical: `${WEBSITE}/privacy-choices` },
};

export default function PrivacyChoicesPage() {
  return (
    <PageShell
      eyebrow="Your privacy choices"
      title={<>Nothing to opt out of.</>}
      standfirst="We do not sell your information and we do not share it for advertising, so there is no switch here to turn off."
    >
      <Reveal>
        <div
          className="mt-10 rounded-2xl p-7"
          style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
        >
          <p className={TYPE.body} style={{ color: COLOUR.body }}>
            We never sell your personal information. We never share it for advertising. No
            ad networks, no tracking across other sites, no profile of where you have been.
          </p>
          <p className={`mt-3 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
            The privacy policy in the app makes the same commitment, and that is the version
            that binds us.
          </p>
        </div>
      </Reveal>

      <Section title="What we do hold">
        <p>
          Only what a booking needs: who you are, how to reach you, the sessions you have
          booked or hosted, and what was paid. Stripe holds your card details — we never see a
          full card number.
        </p>
        <p>
          If you share your location, we use it once to put the nearest rooms first. It is
          not saved to your account and not kept afterwards.
        </p>
      </Section>

      <Section title="What you can ask for">
        <p>
          See what we hold, have it corrected, or have your account deleted. In California
          these are your rights under the CCPA, and using them changes nothing about how we treat
          you. We would do the same for anyone, anywhere.
        </p>
        <p>
          Write to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="underline underline-offset-2"
            style={{ color: COLOUR.link }}
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          from the address on your account. That is the whole process — no forms, no
          third-party identity checks.
        </p>
      </Section>

      <Section title="What deleting an account actually removes">
        <p>
          Worth being exact about, because &ldquo;we delete your data&rdquo; is a sentence
          almost nobody means literally.
        </p>
        <p>
          <strong style={{ color: COLOUR.ink }}>Deleted:</strong> your profile, your photograph,
          the documents you uploaded, your listings and your sign-in. Documents go first, because
          they are the sensitive part.
        </p>
        <p>
          <strong style={{ color: COLOUR.ink }}>Kept:</strong> completed bookings, because a
          booking is a financial record for two people — deleting yours would erase a host&rsquo;s
          income history too. Reviews stay with your name removed, so one person leaving does not
          rewrite what everyone else said.
        </p>
        <p>
          You cannot delete an account with sessions still ahead — someone has arranged
          their day around them. Finish or cancel those first.
        </p>
      </Section>

      <Section title="Where the binding version lives">
        <p>
          The privacy policy in the app is the one that counts. That is where you agree to
          it and where the version you accepted is recorded.
        </p>
        <p>
          <a
            href={`${APP_URL}/privacy`}
            className="underline underline-offset-2"
            style={{ color: COLOUR.link }}
          >
            Read the privacy policy
          </a>
        </p>
        <p className={TYPE.small} style={{ color: COLOUR.muted }}>
          {LEGAL_ENTITY}, California. If you think we have handled something badly, tell us first —
          and you may also complain to the California Attorney General.
        </p>
      </Section>
    </PageShell>
  );
}
