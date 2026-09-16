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
    // A real handle, or a messaging service used as a hand-off. Do not hide a
    // bare service name: "the Signal in the basement is weak" is ordinary
    // booking logistics, not contact information.
    pattern:
      /(?<![\w])@[a-z][\w.]{2,}|\b(?:message|dm|add|find|contact|reach)\s+(?:me|you)(?:\s+(?:on|via))?\s+(?:whats\s?app|telegram|signal|instagram|insta|snapchat|wechat|viber|messenger)\b|\b(?:whats\s?app|telegram|signal|instagram|insta|snapchat|wechat|viber|messenger)\s*(?:handle|username|is|:|=|@)\s*[$@]?[a-z][\w.\-]{2,}/gi,
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


/**
 * A request to move contact, payment or identity details outside the booking
 * thread. Actual details are masked by `redact`; these phrases are stopped
 * before sending because asking the other party for a number is itself the
 * start of an off-platform handoff.
 */
export function offPlatformRequest(input: string): RedactionKind | null {
  const text = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  /*
   * These are invitations, not keyword matches. Words such as "call",
   * "cash" and "signal" are common booking language, so each rule requires
   * both the thing being requested and the request/handoff around it.
   */
  const phone = [
    /\b(?:send|share|give|drop|tell)\s+(?:me\s+)?(?:your\s+)?(?:phone|mobile|cell|telephone)?\s*(?:number|digits)\b/,
    /\b(?:what(?:'s| is)|where(?:'s| is))\s+(?:the\s+best\s+)?(?:your\s+)?(?:phone|mobile|cell|telephone)(?:\s+number)?\b/,
    /\b(?:can|could|would|will|may)\s+(?:you\s+)?(?:send|share|give|text|call)\s+(?:me\s+)?(?:your\s+)?(?:phone|mobile|cell|telephone|number|digits)\b/,
    /\bcan\s+i\s+(?:have|get)\s+(?:your\s+)?(?:phone|mobile|cell|telephone)?\s*(?:number|digits)\b/,
    /\b(?:text|call)\s+me\s+(?:instead|directly|outside|off[- ]?(?:the\s+)?app|privately)\b/,
    /\b(?:reach|contact)\s+(?:me|you)\s+(?:by|on|via)\s+(?:phone|text|call)\b/,
    /(?:^|\s)(?:telefon\s+|cep\s+)?numaran(?:ı|i)?\s+(?:gönder|paylaş|ver)(?=\s|[?.!,]|$)/u,
  ];
  if (phone.some((pattern) => pattern.test(text))) return "phone";

  const email = [
    /\b(?:send|share|give|drop|tell)\s+(?:me\s+)?(?:your\s+)?e[ -]?mail(?:\s+address)?\b/,
    /\b(?:what(?:'s| is)|where(?:'s| is))\s+(?:your\s+)?e[ -]?mail(?:\s+address)?\b/,
    /\b(?:can|could|would|will|may)\s+(?:you\s+)?e[ -]?mail\s+me\b/,
    /\b(?:reach|contact)\s+(?:me|you)\s+(?:by|on|via)\s+e[ -]?mail\b/,
    /(?:^|\s)e[- ]?posta(?:\s+adres(?:in|ini))?\s+(?:gönder|paylaş|ver)(?=\s|[?.!,]|$)/u,
  ];
  if (email.some((pattern) => pattern.test(text))) return "email";

  const channel =
    "(?:whats\\s?app|telegram|signal|instagram|insta|snapchat|wechat|viber|messenger|facebook|facetime|social(?: media)?|handle|username)";
  const social = [
    new RegExp(`\\b(?:send|share|give|drop|tell)\\s+(?:me\\s+)?(?:your\\s+)?${channel}\\b`),
    new RegExp(`\\b(?:what(?:'s| is)|where(?:'s| is))\\s+(?:your\\s+)?${channel}\\b`),
    new RegExp(`\\b(?:message|dm|add|find|contact|reach)\\s+(?:me|you)\\s+(?:on|via)\\s+${channel}\\b`),
    new RegExp(`\\b(?:move|take|continue|talk|chat|communicate|message)\\s+(?:this|there|with me|with you)?\\s*(?:on|over to|via)\\s+${channel}\\b`),
    new RegExp(`\\b(?:can|could|would|will|may)\\s+(?:we|you)\\s+(?:move|continue|talk|chat|message|connect)\\s+(?:on|via|over to)\\s+${channel}\\b`),
    new RegExp(`\\b(?:let(?:'s| us)|can we)\\s+(?:use|switch to|move to)\\s+${channel}\\b`),
    /(?:^|\s)(?:whats\s?app|telegram|instagram|insta|signal)(?:'(?:tan|ten|dan|den|a|e))?\s+(?:yaz|geçelim|konuşalım|mesaj\s+at)(?=\s|[?.!,]|$)/u,
  ];
  if (social.some((pattern) => pattern.test(text))) return "handle";

  const payment = [
    /\b(?:pay|send|transfer)\s+(?:me|you)?\s*(?:directly|privately|outside|off[- ]?(?:the\s+)?app)\b/,
    /\b(?:pay|send|transfer|use|accept)\b.{0,35}\b(?:venmo|paypal|cash\s?app|zelle|revolut|apple\s?pay)\b/,
    /\b(?:venmo|paypal|cash\s?app|zelle|revolut|apple\s?pay)\b.{0,35}\b(?:me|you|directly|instead|outside|off[- ]?(?:the\s+)?app|easier)\b/,
    /\b(?:let(?:'s| us)|can we)\s+(?:use|do|pay (?:with|on))\s+(?:venmo|paypal|cash\s?app|zelle|revolut|apple\s?pay)\b/,
    /\b(?:pay|book|do)\s+(?:me|you)?\s*(?:for\s+)?(?:this|it|the session|the booking)?\s*(?:in\s+)?cash\s+(?:instead|directly|outside|off[- ]?(?:the\s+)?app)\b/,
    /\b(?:avoid|skip|save)\s+(?:the\s+)?(?:app|platform|booking|service)?\s*(?:fee|fees)\b/,
    /(?:^|\s)(?:venmo|paypal|cash\s?app|zelle|revolut)(?:'(?:tan|ten|dan|den|la|le))?\s+(?:yapalım|ödeyelim|gönderelim|atalım)(?=\s|[?.!,]|$)/u,
    /(?:^|\s)uygulama\s+dışında\s+(?:ödeyelim|ödeme\s+yapalım|rezervasyon\s+yapalım)(?=\s|[?.!,]|$)/u,
  ];
  if (payment.some((pattern) => pattern.test(text))) return "payment";

  const link = [
    /\b(?:send|share|give|drop)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:website|site|link|booking link)\b/,
    /\b(?:what(?:'s| is)|where(?:'s| is))\s+(?:your\s+)?(?:website|site|booking link)\b/,
    /\b(?:book|pay|contact|message)\s+(?:me\s+)?(?:through|via|on)\s+(?:your\s+)?(?:website|site|link)\b/,
  ];
  if (link.some((pattern) => pattern.test(text))) return "link";

  const outside = /\b(?:outside|off[- ]?(?:the\s+)?app|off[- ]?platform|elsewhere|privately)\b/;
  const handoff = /\b(?:move|take|continue|talk|chat|communicate|contact|message|book|pay)\b/;
  const proposal = /\b(?:can|could|would|should|shall|may)\s+we\b|\blet(?:'s| us)\b|\bwhy don't we\b/;

  // Generic handoff language with no named channel: "can we talk outside the app?"
  if (outside.test(text) && handoff.test(text) && proposal.test(text)) return "handle";

  if (
    /(?:^|\s)uygulama\s+dışında\s+(?:konuşalım|yazışalım|mesajlaşalım)(?=\s|[?.!,]|$)/u.test(text)
  ) return "handle";

  if (
    /\b(?:send|share|give)\s+(?:me\s+)?(?:your\s+)?contact (?:info|information|details)\b/.test(text) ||
    /\b(?:what(?:'s| is)|can i (?:have|get))\s+(?:your\s+)?contact (?:info|information|details)\b/.test(text)
  ) return "phone";

  return null;
}

export function explainOffPlatformRequest(kind: RedactionKind): string {
  const what: Record<RedactionKind, string> = {
    phone: "phone numbers",
    email: "email addresses",
    link: "external links",
    handle: "social or messaging details",
    payment: "off-app payment details",
  };
  return `Keep ${what[kind]} private. Use this thread for everything about the booking so both sides keep the booking record, support and refund protection.`;
}

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

  /*
   * Says what the sender loses, not what we prefer.
   *
   * The old wording listed what the app does, which reads as marketing at the
   * exact moment somebody is trying to move a conversation elsewhere. What
   * they need to weigh is that a session arranged off the app has nothing
   * behind it — and that this is the sentence they were shown beforehand.
   */
  return (
    `We hid ${phrase}. Keep this booking in the app: the door code, the refund if it falls ` +
    `through, and anyone to call if it goes wrong all depend on it. A session arranged ` +
    `elsewhere is between the two of you.`
  );
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
