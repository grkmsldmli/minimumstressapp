import { BRAND, LEGAL_ENTITY, SUPPORT_EMAIL } from "./company";
import { digestOf } from "./terms";

/**
 * The Host Terms: a second agreement, on top of the general Terms of Service,
 * that only somebody listing a space ever sees.
 *
 * Why separate. The general terms are what everybody accepts to use the app,
 * and the acceptance record (profiles.terms_version) proves it. Listing a
 * space is a different undertaking with obligations a guest never takes on —
 * the right to offer the room, the accuracy of what is listed, responsibility
 * for access and for the property. Folding those into the general terms would
 * make every guest agree to a landlord's obligations they will never have, and
 * make the host's acceptance of them unprovable because it was never a
 * separate, dated event.
 *
 * So this mirrors the general-terms machinery exactly — a version, a digest
 * pinned in a test, a per-account acceptance record with a server timestamp —
 * on its own columns and its own version line. See migration 0052 and
 * host-terms.test.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ATTORNEY REVIEW. This text was drafted from the product as it actually
 * works — the payout model, the claim window, the review step, the account
 * suspension powers all traced to code before they were written down — but it
 * is not legal advice and has not been reviewed by counsel. Points that turn
 * on a legal judgement rather than a product fact are marked below with
 * REVIEW, and collected in docs/counsel-brief.md. Nothing here should ship as
 * final without an attorney reading it.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Raise this when the Host Terms change in a way that changes what a host is
 * agreeing to. Every host is then asked to accept again before their next
 * listing action — see the gate in migration 0052 and the re-accept flow.
 *
 * Independent of TERMS_VERSION on purpose: the two documents change for
 * different reasons and a host should not be re-asked to accept the hosting
 * agreement because a privacy clause moved.
 *
 * The database holds the same number in `required_host_terms_version()`, and a
 * schema test asserts the two agree — the DB is the authority the acceptance
 * trigger stamps from, this constant is what the client checks against.
 */
export const HOST_TERMS_VERSION = 1;

/** When the current Host Terms took effect, beside the version so they move together. */
export const HOST_TERMS_EFFECTIVE = new Date("2026-08-18T00:00:00Z");

export function hostTermsEffectiveLabel(): string {
  return HOST_TERMS_EFFECTIVE.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface HostTermsSection {
  key: string;
  title: string;
  points: readonly string[];
}

/**
 * The agreement itself.
 *
 * Plain English, one obligation per line, each one traceable to how the
 * product actually behaves. Where a line states a fact about the app (the
 * payout model, the claim window, what a suspension can do) it was checked
 * against the code; where it states a legal position (independent-contractor
 * status, the limit of our role in a booking) it is marked REVIEW and left for
 * counsel rather than asserted as settled.
 */
export const HOST_TERMS_SECTIONS: readonly HostTermsSection[] = [
  {
    key: "right-to-offer",
    title: "Your right to offer the space",
    points: [
      "You confirm that you own the space, or hold a lease, sublease or other legal right that lets you offer it for paid bookings.",
      "If a landlord, property owner, building, HOA or other party has to consent before you can do this, getting that consent is your responsibility, not ours.",
      "You may not list a space in a way that breaks your lease, your building's rules, an HOA rule, or any other agreement you are bound by.",
      `${BRAND} may ask you for proof of your right to offer the space, and may hold a listing back until you provide it.`,
    ],
  },
  {
    key: "listing-accuracy",
    title: "Keeping your listing accurate",
    points: [
      "You confirm that your photos, address, capacity, amenities, access details, availability, allowed uses, house rules and accessibility information are accurate and current.",
      "You keep them up to date as things change.",
      `If a space is materially different from its listing, ${BRAND} may pause or remove the listing.`,
    ],
  },
  {
    key: "your-control",
    title: "What you control",
    points: [
      "You set your own availability, rate and capacity.",
      "You choose which uses your space is offered for, and your own house rules.",
      "You choose how bookings reach you — approve each request yourself, or let a matching booking go straight through.",
      "You choose how guests get in, and provide the access instructions for confirmed bookings.",
      `You cannot override the ${BRAND} rules that apply to every space. What you allow sits on top of the platform's floor; it cannot lower it.`,
    ],
  },
  {
    key: "permitted-use",
    title: "What a space may and may not be used for",
    points: [
      "You may offer your space for legitimate uses you are comfortable with — for example personal practice, dance and movement rehearsal, yoga and Pilates, meditation and breathwork, private sessions, coaching, small group classes, workshops, and photography or filming you have allowed.",
      "Some uses are never permitted, whatever a host allows. These include sexual activity or services, adult-content production, prostitution or escort activity, anything illegal, illegal drugs, weapons where prohibited or unsafe, hazardous activities, parties and nightlife events, entering outside the booked time, more people than the booking declared, a use materially different from the one declared, undeclared commercial production, and anything that damages the space or creates an unreasonable safety risk.",
      "You cannot allow one of these prohibited uses by ticking it on your listing. The platform's list is a floor nobody can lower.",
    ],
  },
  {
    key: "bookings",
    title: "Bookings",
    points: [
      "Bookings for your space are made and managed through the platform.",
      "Every guest declares what they will use the space for and how many people are coming before they pay, and you see both.",
      "Where you accept bookings yourself, a request is not confirmed until you approve it. Where you allow matching bookings straight through, a booking that fits your listing and the platform rules can be confirmed automatically.",
      "You may not take a confirmed booking off the platform, resell it, or arrange payment for it outside the platform.",
      // REVIEW: anti-circumvention wording. The general Terms already prohibit
      // off-platform arrangements; this restates it for hosts. Counsel should
      // confirm the two are consistent and enforceable together.
    ],
  },
  {
    key: "access",
    title: "Access",
    points: [
      "You provide accurate access instructions and make sure the space is actually accessible for the times somebody has booked.",
      "You keep any door code, key or lockbox information correct and current.",
      "Private access details are shared only with the confirmed booking they are for, at the appropriate time. You keep them private otherwise.",
    ],
  },
  {
    key: "rate-payout",
    title: "Your rate, payouts and fees",
    points: [
      "You set your own rate, and you receive that rate in full. Nothing is deducted from it.",
      "The platform's service fee is added on top and paid by the guest. It is never taken out of what you are owed.",
      "You are paid after a session has taken place, through the payment processor, into the account you connect. Payout timing depends on the processor.",
      "You are responsible for your own taxes on what you earn.",
    ],
  },
  {
    key: "cancellations",
    title: "Cancellations and no-shows",
    points: [
      "The cancellation terms shown to guests apply to bookings on your space.",
      "If you cancel a confirmed booking, the guest is refunded and that booking's access is withdrawn.",
      "Repeated late cancellations count against a host the same way they count against a guest, and can pause your ability to take bookings for a period.",
      // REVIEW: this describes the existing reliability/standing model
      // (listCancellationHistory + suspension). Counsel should confirm the
      // consequence is stated no more strongly than the system enforces.
    ],
  },
  {
    key: "damage",
    title: "Damage and claims",
    points: [
      `If a guest damages your space, you can report it through ${BRAND} within the reporting window shown in the app after the session.`,
      "A member of staff reviews the report. The outcome depends on the evidence and on what the payment system supports.",
      // REVIEW: the app authorises a card at booking, which is what a claim can
      // draw on; do not state a broader recovery power than that authorisation
      // and the claim process actually support. Counsel to confirm the wording
      // matches the payment authorisation in place.
    ],
  },
  {
    key: "insurance",
    title: "Insurance",
    points: [
      "You are responsible for your own property and business insurance for your space.",
      `${BRAND} does not provide insurance for your space, your property, or the sessions that take place in it.`,
      "You may upload an insurance certificate with your listing. Some uses may carry their own insurance requirements, which are shown where they apply.",
      // REVIEW: whether client-facing/professional bookings should carry a
      // separate liability-insurance requirement is a product-and-legal
      // decision, not yet built. Left as "where they apply" until it is.
    ],
  },
  {
    key: "compliance",
    title: "Permits, taxes and compliance",
    points: [
      "You are responsible for meeting the laws that apply to your space — business permits, zoning, occupancy limits, fire and building rules, licensing and tax obligations.",
      `${BRAND} does not certify, guarantee or check these for you.`,
    ],
  },
  {
    key: "independent",
    title: "You are an independent operator",
    points: [
      `You act as an independent business and operator of your own space. ${BRAND} does not own your space, does not employ you, is not your business partner, and does not run your space.`,
      // REVIEW: the general Terms state the marketplace "is not a party to the
      // room booking itself." That platform-role wording is under attorney
      // review (docs/counsel-brief.md) given that the platform collects
      // payment, holds it, sets the fee, controls access release and decides
      // refunds. This section deliberately does not repeat that broad
      // disclaimer; keep it that way until counsel resolves it.
    ],
  },
  {
    key: "reviews",
    title: "Reviews",
    points: [
      "After a session, the review system may be used by the people involved.",
      "You may not create fake reviews, or try to manipulate or trade reviews.",
    ],
  },
  {
    key: "content",
    title: "Your listing content",
    points: [
      "You confirm you have the right to upload the photos, descriptions and information in your listing.",
      `You give ${BRAND} the limited licence it needs to show and market your listing within the platform. You keep ownership of your content.`,
    ],
  },
  {
    key: "suspension",
    title: "Suspension and removal",
    points: [
      `${BRAND} may investigate, pause a listing, remove a listing, cancel future bookings where appropriate, or suspend or close an account, where there is fraud, a materially false listing, a prohibited use, an unsafe space, repeated access failures, repeated serious complaints, or a breach of these terms.`,
      "Closing your account does not release you from obligations to guests whose bookings you have already taken.",
    ],
  },
];

/**
 * A plain-language summary, shown above the agreement on the published page.
 *
 * Not part of the agreement, and deliberately not part of the digest: it is a
 * reader's aid so a host understands the shape of what they are signing in the
 * first ten seconds, before reading the sections that actually bind them. The
 * binding text is HOST_TERMS_SECTIONS; changing these lines does not change
 * what a host accepts and must never be treated as if it does — which is why
 * hostTermsDigest() hashes the sections and not this.
 *
 * Each line points at a section below rather than adding anything new to it.
 */
export const HOST_TERMS_SUMMARY: readonly string[] = [
  "You must have the right to offer the space.",
  "You control availability, rate and allowed uses.",
  "Guests must declare their booking purpose.",
  "Platform-wide prohibited uses always apply.",
];

/**
 * A fingerprint of the exact Host Terms text, pinned in host-terms.test.ts.
 *
 * Same reasoning and same function as termsDigest: editing the agreement
 * without raising HOST_TERMS_VERSION fails the suite rather than silently
 * changing what a stored acceptance means. Reuses digestOf so there is one
 * hashing implementation, not two.
 */
export function hostTermsDigest(): string {
  return digestOf(
    HOST_TERMS_SECTIONS.flatMap((section) => [section.title, ...section.points]).join("\n"),
  );
}

/** True when this account has accepted the Host Terms as they currently stand. */
export function hasAcceptedHostTerms(accepted: { hostTermsVersion: number | null }): boolean {
  return accepted.hostTermsVersion !== null && accepted.hostTermsVersion >= HOST_TERMS_VERSION;
}

/**
 * The one line beside the checkbox at the point of listing.
 *
 * The full agreement is a tap away; this is what somebody actually ticks. It
 * pairs the promise the whole document turns on — the right to offer the space
 * — with the acceptance itself, because that is the representation most likely
 * to matter and the one worth putting in front of the person every time.
 */
export const HOST_TERMS_CONFIRMATION =
  "I agree to the Minimum Stress Host Terms and confirm that I have the right to offer this space.";

/** For the footer of the published agreement. */
export const HOST_TERMS_ENTITY = LEGAL_ENTITY;
export const HOST_TERMS_CONTACT = SUPPORT_EMAIL;
