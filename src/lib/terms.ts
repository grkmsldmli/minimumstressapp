import { SECTIONS } from "./legal-text";

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
export const TERMS_VERSION = 2;

/**
 * A fingerprint of the exact words a version stands for.
 *
 * The record of an acceptance stores a number. That is enough to ask "did they
 * agree", and not enough to answer the question that actually gets asked in a
 * dispute: agree to *what*. The text lives in code, so producing what version 1
 * said means going through git history and trusting that nobody edited it
 * without raising the number — which is precisely the mistake this guards.
 *
 * So the words are hashed, and the hash for the current version is pinned in
 * terms.test.ts. Editing the text without raising TERMS_VERSION now fails the
 * suite rather than silently rewriting what a thousand stored acceptances mean.
 *
 * FNV-1a, not SHA. This detects change; it is not a cryptographic commitment
 * against a determined forger, and nothing here pretends otherwise. What makes
 * it evidence is that it is checked in CI against a number in a committed file,
 * not the strength of the function.
 */
export function digestOf(text: string): string {
  // FNV-1a over 32 bits, in the integer arithmetic geo.ts already uses for
  // its own mixing. BigInt would read more plainly and is not available at
  // this compile target.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The fingerprint of the text TERMS_VERSION currently stands for. */
export function termsDigest(): string {
  return digestOf(SECTIONS.flatMap((section) => [section.title, ...section.points]).join("\n"));
}


/**
 * When the current text took effect.
 *
 * Beside the version rather than in the page that prints it, so the two move
 * together: a version raised without a date is a document that cannot say when
 * it changed, and a date without a version is one nobody can prove they saw.
 *
 * Raise both when the terms change in a way that changes what somebody is
 * agreeing to.
 */
export const TERMS_EFFECTIVE = new Date("2026-08-13T00:00:00Z");

/** "13 August 2026" — for the footer of a published document. */
export function effectiveDateLabel(): string {
  return TERMS_EFFECTIVE.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

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
    body: "Payment, refunds, cancellation cover, access codes, reviews and support are provided only for bookings made through Minimum Stress.",
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
