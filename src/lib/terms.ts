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
export const TERMS_VERSION = 3;

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
export const TERMS_EFFECTIVE = new Date("2026-08-23T00:00:00Z");

/** "23 August 2026" — for the footer of a published document. */
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
/**
 * What somebody has to know before they tap agree.
 *
 * Three, and the test is narrow: does not knowing this change what a person
 * does? Book in the app, use the room for what you said, keep to the host's
 * rules. Those are behaviours. Everything else on this screen was not.
 *
 * It used to carry four cards of full paragraphs, including the entity name,
 * the independent-contractor position and a hundred-word sentence about
 * off-platform liability. All of that is still binding and still published —
 * SECTIONS in legal-text.ts is the document, /terms is where it lives, and the
 * link under the button goes there. None of it was ever going to be read on a
 * navy screen standing between somebody and the app, and a wall of legal prose
 * at the door does not produce informed consent. It produces scrolling.
 *
 * Deliberately not part of termsDigest(): that hashes SECTIONS, so shortening
 * this screen changes what is shown and not what was agreed, and nobody is
 * asked to accept again for a UI change.
 */
export const ACCEPTANCE_POINTS = [
  {
    title: "Book and pay through Minimum Stress",
    body: "Payment, refunds, access codes and support only cover bookings made here.",
  },
  {
    title: "Use the space only for what you declared",
    body: "You say what a booking is for and how many people are coming. Turning up with something else ends the booking.",
  },
  {
    title: "Follow the host's rules and limits",
    body: "It is their room. Their house rules and the number it holds both apply.",
  },
] as const;
