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
      title={<>There is nothing here to opt out of.</>}
      standfirst="Not as a figure of speech. We do not sell personal information and we do not share it for cross-context advertising, so the switch this page usually carries would not be connected to anything."
    >
      <Reveal>
        <div
          className="mt-10 rounded-2xl p-7"
          style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
        >
          <p className={TYPE.body} style={{ color: COLOUR.body }}>
            No sale of personal information. No sharing for cross-context behavioural advertising.
            No advertising network, no cross-site tracking, and no profile built from where you
            have been.
          </p>
          <p className={`mt-3 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
            This is the same commitment as the privacy policy in the app, which is the version that
            binds us.
          </p>
        </div>
      </Reveal>

      <Section title="What we do hold">
        <p>
          What a booking needs, and not much beyond it: who you are, how to reach you, the sessions
          you have booked or hosted, and what was paid. Card details are held by Stripe rather than
          by us — we never see a full card number.
        </p>
        <p>
          A location, if you share one, is used once to sort the nearest rooms first. It is not
          attached to your account and not kept after the request.
        </p>
      </Section>

      <Section title="What you can ask for">
        <p>
          To see what we hold, to have it corrected, and to have your account deleted. In
          California these are rights under the CCPA and we will not treat you differently for
          using them; in practice we would do the same for anybody who asked from anywhere.
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
          from the address on the account. That is the whole process — there is no form and no
          identity-verification vendor in between.
        </p>
      </Section>

      <Section title="What deleting an account actually removes">
        <p>
          This is worth being exact about, because &ldquo;we will delete your data&rdquo; is a
          sentence almost nobody means literally.
        </p>
        <p>
          <strong style={{ color: COLOUR.ink }}>Removed:</strong> your profile, your photograph,
          the verification documents you uploaded, your listings, and your sign-in. Documents go
          first, deliberately — they are the sensitive part, and a half-finished deletion should
          not leave a lease on disk with the record of what it belonged to gone.
        </p>
        <p>
          <strong style={{ color: COLOUR.ink }}>Kept:</strong> completed bookings, because a booking
          is a financial record for two people and deleting yours would take a host&rsquo;s own
          income history with it. Reviews stay too, with your name detached — a listing&rsquo;s
          rating is partly other people&rsquo;s contribution, and one person leaving should not
          rewrite what everybody else said.
        </p>
        <p>
          An account with sessions still ahead of it cannot be deleted until those are done or
          cancelled. Somebody has arranged their day around them.
        </p>
      </Section>

      <Section title="Where the binding version lives">
        <p>
          The privacy policy in the app is the authority, because that is where it is agreed to and
          where the version you accepted is recorded against your account. A second copy out here
          would be a second policy, free to drift from the one people actually signed.
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
