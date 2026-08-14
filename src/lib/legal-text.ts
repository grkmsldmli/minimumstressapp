import { BRAND, LEGAL_ENTITY } from "./company";

/**
 * The binding text, in one place, read by everything that shows it.
 *
 * It lived inside the in-app screen, which was fine while that screen was the
 * only reader. It is not any more: Google will not verify an OAuth consent
 * screen without a public privacy policy and terms at their own addresses, so
 * the same words now have to appear at /privacy and /terms as well.
 *
 * Copying them there would have been quicker and would have broken the one
 * thing this text has to do. Acceptance is recorded against it with a version
 * and a timestamp — see TERMS_VERSION — and two copies drift the moment one is
 * edited, which turns every stored acceptance into a record of text nobody can
 * produce. One array, three readers, no second version to forget.
 *
 * The wording is deliberate on one point: a practitioner *licenses a room*.
 * California's AB5 ABC test governs worker classification, and language like
 * "we engage practitioners to..." could blur a relationship that is
 * structurally a customer renting space. Nothing here describes anyone as
 * engaged, hired, or providing services to us.
 */

/** Which public document a section belongs to. */
export type LegalScope = "terms" | "privacy";

export interface LegalSection {
  key: string;
  title: string;
  /**
   * The split is by subject, not by convenience. A privacy policy that opens
   * with a cancellation schedule is one nobody reads to the end, and a
   * regulator reading it for what happens to personal data has to hunt.
   */
  scope: LegalScope;
  points: readonly string[];
}

export const SECTIONS: readonly LegalSection[] = [
  {
    key: "terms",
    title: "Terms of Service",
    scope: "terms",
    points: [
      `These terms are between you and ${LEGAL_ENTITY}, which operates ${BRAND}.`,
      `${BRAND} runs a marketplace. We are not a party to the room booking itself, nor to the session a practitioner runs with their own client.`,
      "Practitioners and hosts are independent businesses. A practitioner licenses a room by the hour — they are our customer, not our worker, and nothing in this arrangement makes them one.",
      "Hosts set their own rate and receive all of it. Our service fee is added on top for the practitioner; it is never deducted from what a host is owed.",
      "Hosts must hold the legal right to sublicense their space for paid sessions, and remain responsible for their own property and insurance.",
    ],
  },
  {
    key: "off-platform",
    title: "Booking outside the app",
    scope: "terms",
    points: [
      "All bookings and payments must be made through Minimum Stress. Payment, refunds, cancellation cover, access codes, reviews, emergency contacts and support apply only to bookings recorded in the app.",
      "Users must not exchange phone numbers, email addresses or payment details. These are removed from messages automatically. Requesting or providing them may result in suspension.",
      "Minimum Stress is not a party to any session arranged or paid for outside the app. We hold no record of such arrangements and provide no payment protection, refund, access, verification, insurance or dispute resolution in respect of them. Liability rests with the parties who made them.",
      "Soliciting users to transact outside the app is a breach of these terms and may result in permanent suspension.",
    ],
  },
  {
    key: "wellness",
    title: "Health and Wellness",
    scope: "terms",
    points: [
      `${LEGAL_ENTITY} operates a booking platform. It does not own, let or control the spaces listed, and does not provide medical, therapeutic, psychological or health services. Nothing in the app is medical advice.`,
      "Practitioners are solely responsible for the services they deliver, for holding the qualifications, registrations and insurance those services require, and for their own clients.",
      `${BRAND} does not verify a practitioner's qualifications, training or fitness to practise. Hosts and clients should carry out their own checks.`,
      "A room listing describes a space, not the suitability of that space for any particular practice. Practitioners must satisfy themselves that a room is appropriate before using it.",
    ],
  },
  {
    key: "privacy",
    title: "What we collect",
    scope: "privacy",
    points: [
      "Your account: email address, and a name and photograph if you add one. A phone number only if you give us one for notifications.",
      "Your listings or bookings: what you wrote about a room, its address, its hours, and the sessions booked on it.",
      "Documents you upload: proof you may sublicense a space, insurance certificates, and any certificate a practitioner chooses to keep on file.",
      "Messages you send through the app, with phone numbers and email addresses removed automatically before they are stored.",
      "An emergency contact, if you give us one.",
      "Card details are handled by Stripe and never reach us. We hold the identifiers Stripe gives us so we can charge and pay the right accounts.",
    ],
  },
  {
    /*
     * Named, because "trusted partners" is not a disclosure. Every one of
     * these is in the code and can be checked: stripe/, notify/transports.ts,
     * geocode-google.ts, map-tiles.ts, supabase/. Twilio is listed as unused
     * rather than left out, so that turning it on is a change to this text
     * rather than a quiet extension of who has your number.
     */
    key: "processors",
    title: "Who else handles it",
    scope: "privacy",
    points: [
      "Supabase stores the database, the uploaded files, and the sign-in session. Vercel serves the app.",
      "Stripe takes payments, holds card details, and pays hosts. Their own privacy policy governs what they hold.",
      "Resend sends the emails — booking confirmations, codes, and the rest.",
      "Google Places resolves an address while it is being typed. The lookup happens on our server, so the half-typed address does not leave your device for Google directly.",
      "MapTiler serves the map images. It receives the tiles being requested, which is roughly the area on screen, not who is looking.",
      "Signing in with Google or Microsoft tells us your email address and name, and tells them that you signed in here.",
      "Twilio is configured for emergency SMS and is not switched on. Nothing is sent to them today.",
      "We do not sell or share personal information, and we run no advertising or cross-site tracking.",
    ],
  },
  {
    key: "keeping",
    title: "How long we keep it",
    scope: "privacy",
    points: [
      "You can delete your account from your profile whenever you have no sessions still ahead of you.",
      "Deleting removes you: your documents, your photograph, your profile, and your sign-in.",
      "It does not remove a completed booking. That is a financial record belonging to two people, and erasing it would take a host's own income history with it.",
      "Reviews are detached from your name rather than deleted, because a room's rating is partly what everybody else wrote.",
      "Records we must keep for tax and accounting are kept for as long as the law requires, and no longer.",
    ],
  },
  {
    /*
     * California, because that is where the company is and where the first
     * rooms are. Written as what somebody does rather than as a citation: a
     * right nobody can find the door to is not a right.
     */
    key: "rights",
    title: "Your rights",
    scope: "privacy",
    points: [
      "You can ask what we hold about you, ask for a copy, ask us to correct it, or ask us to delete it.",
      "Write to us and we will answer within 45 days. We will not ask you for anything beyond what is needed to check it is you.",
      "Using any of these will never cost you anything, and will never change the price you are shown or the rooms you can book.",
      "We do not sell personal information and we do not share it for cross-context advertising, so there is nothing here to opt out of.",
      "If you think we have handled something badly, tell us first — and you may also complain to the California Attorney General.",
    ],
  },
  {
    key: "security-and-age",
    title: "Security, and who this is for",
    scope: "privacy",
    points: [
      "Data is encrypted in transit and at rest by our hosting and payment providers. Access to documents is restricted to the people reviewing them.",
      "No system is perfect. If a breach affects you, we will tell you.",
      "Minimum Stress is for adults. It is not for anyone under 18, we do not knowingly collect anything from a child, and we delete it if we find we have.",
      "If we change this policy in a way that changes what we do with your information, we will tell you before it takes effect rather than after.",
    ],
  },
  {
    key: "location",
    title: "Location",
    scope: "privacy",
    points: [
      "Sharing your location is optional. Every part of the app works without it — you can browse everything, search by ZIP code, and book normally.",
      "When you do share it, it is used once, to put the nearest rooms first. It is sent to our server, used to sort that one list, and not written down. It is not attached to your account and not kept after the request.",
      "We never share it with anyone, and we never use it to build a picture of where you go.",
      "You can stop at any time — the app forgets your answer the moment you close it, so it will ask again rather than assume.",
      "Distances are deliberately imprecise. A listing's exact position is private until it is booked, so a room half a mile away is shown as half a mile away and never any closer than that.",
    ],
  },
  {
    key: "reviews",
    title: "Reviews and Safety",
    scope: "terms",
    points: [
      "After a session, both sides can review each other. Neither review is visible until you have both written, or until 14 days have passed — so nobody is answering a review they have already read.",
      "A rating of three or below, or a review that flags a safety concern, is read by a person on our team.",
      "The safety flag is recorded separately from the rating. A session rated five stars can still carry a safety concern, and the flag is read whatever the rating says.",
      "We never tell either side whether a review was escalated, and we never share who reported what without asking first.",
      "Both hosts and practitioners can give us an emergency contact. Nobody you book with ever sees it — only our team, and only if something goes wrong during a session.",
    ],
  },
  {
    key: "cancel",
    title: "Cancellation Policy",
    scope: "terms",
    points: [
      "You pay when you book. We hold the money until the session has happened, then pay the studio.",
      "Cancel 24 or more hours ahead and you are refunded, back to the card you paid with, apart from what the card network charges to process a payment — it keeps that whether or not the session happens, and we do not add anything to it.",
      "If the studio cancels on you, you get everything back including that fee. You did not cause it and you do not pay for it.",
      "Cancel inside 24 hours, or fail to attend, and the full amount is captured.",
      "If a host cancels on you, you are refunded automatically. That refund is never replaced by credit or made optional.",
      "If something went wrong with a session you paid for, you can ask for a refund within 7 days. You pick a reason and tell us what happened.",
      "Where the reason points at the studio, we ask them what happened before deciding, and a person reads both accounts. Anything unsafe skips that and reaches a person immediately.",
      "Three outcomes: everything back, our service fee back with the studio keeping their rate, or nothing. You are told which and why.",
      "If we refund in full for something the studio got wrong, we take their payment back too. You are never refunded out of another practitioner's pocket, and no studio is charged for a decision we made without asking them.",
    ],
  },
  {
    key: "standing",
    title: "Repeated Cancellations",
    scope: "terms",
    points: [
      "Cancellations made 24 or more hours ahead do not count towards your standing. Only those inside the window do.",
      "Hosts: three last-minute cancellations in 90 days pauses new bookings on your spaces for 14 days. Two brings a warning first, so it is never a surprise.",
      "Practitioners: six in 90 days pauses new bookings for 14 days. The bar is higher because a late cancellation already charges you in full — the host is paid for the hour they set aside, so the loss between you is settled. A host cancelling leaves someone with no room and sometimes a client already waiting, which nothing makes right.",
      "A pause stops new bookings only. Every session already on the calendar goes ahead. Cancelling those would land the harm on somebody who did nothing.",
      "Pauses lift on their own after 14 days, and cancellations stop counting after 90. Nothing here is permanent.",
      "You can see exactly where you stand in your profile, at any time, whether or not anything is wrong. And if a pause looks wrong to you, tell us — a rule with nobody to ask is not a rule we would want to run.",
    ],
  },
];

/** The sections that make up one published document. */
export function sectionsFor(scope: LegalScope): readonly LegalSection[] {
  return SECTIONS.filter((section) => section.scope === scope);
}
