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
 * Short, and each one a consequence rather than a rule. "Don't share your
 * number" reads as a house style; what somebody needs before they type it is
 * what stops applying the moment they do.
 */
export const ACCEPTANCE_POINTS = [
  {
    title: "Keep bookings in the app",
    body: "The card that is held rather than charged, the refund if a host cancels, the door code, and somebody to call when it goes wrong — all of it runs off the booking record.",
  },
  {
    title: "Don't swap contact details",
    body: "Phone numbers and email addresses are hidden in messages. Asking for them is a reason an account can be suspended.",
  },
  {
    title: "Sessions arranged elsewhere are your own",
    body: "If you book or pay outside Minimum Stress we have no record of it and cannot help with payment, access, damage, injury or a dispute. We can only stand behind what we can see.",
  },
  {
    title: "You are running your own business",
    body: "Practitioners and hosts are independent. Hosts must hold the right to sublicense their space, and remain responsible for their property and insurance.",
  },
] as const;
