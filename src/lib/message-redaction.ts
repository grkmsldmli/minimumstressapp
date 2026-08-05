/**
 * Keeping contact details out of messages.
 *
 * Two things are protected by the same rule, and it is worth being honest that
 * the second one is commercial. A practitioner should not have to hand over
 * their mobile number to ask whether there is parking, and neither side should
 * be able to move a booking off the platform that arranged it, insured it, and
 * carries the cancellation guarantee if it goes wrong.
 *
 * The choice is to **mask rather than block**. A blocked message teaches people
 * to write "five five five, one two three four" and the next one gets through
 * anyway; a masked one goes to its recipient with the number hidden and both
 * sides told why. Blocking optimises for the appearance of a rule. Masking
 * optimises for the message still doing its job.
 *
 * Deliberately imperfect. Somebody determined will get a number through, and
 * the goal is not to stop them — it is to make the platform the path of least
 * resistance for the ninety-nine per cent who were not trying anything.
 */

export interface Redaction {
  /** The message as the other side sees it. */
  text: string;
  /** What was hidden, so the sender can be told plainly. */
  found: RedactionKind[];
}

export type RedactionKind = "phone" | "email" | "link" | "handle" | "payment";

const MASK = "[hidden]";

/**
 * Order matters. Emails contain dots and digits that a loose phone pattern
 * would chew into, so the most structured patterns run first and the vaguest
 * runs last against what survives.
 */
const PATTERNS: { kind: RedactionKind; pattern: RegExp }[] = [
  {
    kind: "email",
    pattern: /\b[\w.%+-]+\s?(?:@|\(at\)|\[at\]|\sat\s)\s?[\w.-]+\.[a-z]{2,}\b/gi,
  },
  {
    kind: "link",
    // Bare domains too — "dm me on mysite.com" is a link without a scheme.
    pattern: /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|co|app|me|link)\b\S*/gi,
  },
  {
    kind: "payment",
    // The cashtag alternative carries no leading \b on purpose: between a
    // space and a "$" there is no word boundary — both are non-word characters
    // — so "\bvenmo|\b\$sam" silently never matched the second half.
    pattern: /\b(?:venmo|paypal|cashapp|cash\s?app|zelle|revolut)\b|\$[a-z][\w-]{2,}\b/gi,
  },
  {
    kind: "handle",
    // A social handle or an app named alongside one.
    pattern:
      /\b(?:whats\s?app|telegram|signal|instagram|insta|snapchat|wechat|viber|messenger)\b|(?<![\w])@[a-z][\w.]{2,}/gi,
  },
  {
    kind: "phone",
    /**
     * Seven or more digits with the usual separators, which is where a real
     * phone number starts and where a time, a price or a door code stops.
     *
     * The lookarounds are what keep "$45.00" and "2026-08-04" out of it: a
     * match may not sit against a currency symbol or inside a longer run of
     * digits. Getting this wrong in the other direction is worse than missing
     * a number — a host reading "be there at [hidden]" learns to distrust the
     * whole feature.
     */
    pattern:
      /(?<![\d$£€])(?:\+?\d[\d\s().-]{6,}\d)(?![\d])|(?:\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b[\s,-]*){7,}/gi,
  },
];

/**
 * Shapes that are digits and separators but are obviously not phone numbers.
 *
 * A date has the right digit count and the right punctuation, so the phone
 * pattern eats it: "Booked for 2026-08-04" became "Booked for [hidden]". That
 * is the failure that matters most — a host who sees a date disappear stops
 * trusting the thread, and the messages that are lost after that include the
 * one where something goes wrong.
 */
const NOT_A_PHONE = [
  /^\s*\d{4}-\d{1,2}-\d{1,2}\s*$/, // 2026-08-04
  /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/, // 08/04/2026
];

export function redact(input: string): Redaction {
  const found = new Set<RedactionKind>();
  let text = input;

  for (const { kind, pattern } of PATTERNS) {
    text = text.replace(pattern, (match) => {
      // A bare "@" mention of somebody's display name is not a handle, and
      // neither is a lone word. Guarded so the vaguer patterns cost less.
      if (match.trim().length < 3) return match;
      if (kind === "phone" && NOT_A_PHONE.some((shape) => shape.test(match))) return match;
      found.add(kind);
      return MASK;
    });
  }

  return { text, found: [...found] };
}

/** What to tell the sender, in their own terms rather than as a policy citation. */
export function explainRedaction(found: RedactionKind[]): string | null {
  if (found.length === 0) return null;

  const nouns: Record<RedactionKind, string> = {
    phone: "a phone number",
    email: "an email address",
    link: "a link",
    handle: "a social handle",
    payment: "payment details",
  };

  const list = found.map((kind) => nouns[kind]);
  const phrase =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

  return `We hid ${phrase}. Everything about this booking — the address, the door code, the refund if it goes wrong — only works while it stays here.`;
}

/**
 * Whether a message says anything once the masking is done.
 *
 * A message that was nothing but a phone number arrives as "[hidden]", which
 * tells the recipient nothing and looks like the app broke. Better to refuse
 * it and let the sender write a sentence.
 */
export function isEmptyAfterRedaction(redaction: Redaction): boolean {
  return redaction.text.replaceAll(MASK, "").trim().length === 0;
}
