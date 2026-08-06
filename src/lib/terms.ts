/**
 * The terms, and which version of them somebody agreed to.
 *
 * The rule that matters most here is the one about arranging a session off the
 * app: no cover, no refund, nobody to call, and not our responsibility. It was
 * written in the terms and nobody had ever accepted them — a host acknowledged
 * a sublease declaration per listing, and a practitioner accepted nothing at
 * all. "It was in the terms" is worth very little without a record of the
 * moment it was shown and taken.
 *
 * Raise this when the terms change in a way that changes what somebody is
 * agreeing to. Everyone is then asked again, because an acceptance recorded
 * against text they never saw is not an acceptance.
 *
 * Wording, punctuation, a new example: leave it. A new obligation, a new
 * liability, a change to money or cancellation: raise it.
 */
export const TERMS_VERSION = 1;

/** True when this account has accepted the terms as they currently stand. */
export function hasAcceptedTerms(accepted: { version: number | null }): boolean {
  return accepted.version !== null && accepted.version >= TERMS_VERSION;
}

/**
 * The points somebody is agreeing to, in the order they matter.
 *
 * Plainly worded, and each one states what the app does or does not do rather
 * than how it feels about it. An earlier draft ended this section with "we can
 * only stand behind what we can see" — a sentence that sounds like a position
 * and commits to nothing. Anything relied on in a dispute has to be a fact.
 */
export const ACCEPTANCE_POINTS = [
  {
    title: "Book and pay in the app",
    body: "Payment authorisation, refunds, cancellation cover, access codes, reviews and support are provided only for bookings made through Minimum Stress.",
  },
  {
    title: "Do not exchange contact or payment details",
    body: "Phone numbers, email addresses and payment details are removed from messages. Requesting them may result in suspension of your account.",
  },
  {
    title: "Bookings made outside the app are not covered",
    body: "Minimum Stress is not a party to any session arranged or paid for outside the app, holds no record of it, and provides no payment protection, refund, access, verification, insurance or dispute resolution for it. Liability for such arrangements rests with the parties who made them.",
  },
  {
    title: "You are an independent business",
    body: "Practitioners and hosts contract with each other, not with Minimum Stress. Hosts must hold the legal right to sublicense their space and remain responsible for their property, insurance and compliance.",
  },
] as const;
