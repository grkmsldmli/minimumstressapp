/**
 * Jade, the front desk — what she knows and what she can answer without asking.
 *
 * The widget this came from ran on Shopify. It answered from a big lookup
 * table to save tokens, and that turned into its whole personality: the same
 * paragraph every time, no memory of the last message, a form letter for
 * "naber". The traffic cost three cents a month, so the saving was imaginary
 * and the cost was real.
 *
 * So the model answers now. `answerLocally` is down to a safety rail — the few
 * questions where a generative reply could do harm (a prohibited use, a price)
 * or where an email has to be collected first. Everything else is a real
 * conversation.
 *
 * Everything here is the part that changed with the business. The old version
 * sold sessions with consultants, ran a shop, and pointed at Shopify
 * addresses that no longer resolve. This one lets a room, and the difference
 * shows up in every routing rule below.
 *
 * Deliberately absent, and each for a reason:
 *
 * - Products. There is no shop. A cheerful link to herbal tea from a
 *   marketplace for rooms is a leftover, not a cross-sell.
 * - Consultants, coaches, practitioners as *people to be referred to*. We let
 *   space; we do not match anybody with a professional, and copy.test guards
 *   the same rule across the site.
 * - The word "therapy", for the reason space-types.ts already gives.
 * - Anything about the fee, the margin, or how the business is built. It is in
 *   the prompt as a refusal rather than left to judgement.
 */

/**
 * Jade's face.
 *
 * Cropped to a square around the head and served at 256px, because it is
 * drawn at 28 and 36 — the original was 1122x1402 and 1.8MB, which is a
 * megabyte and a half to fill a circle the size of a fingernail.
 */
export const JADE_AVATAR = "/photos/jade.webp";

/**
 * The model, ours now.
 *
 * The old proxy hardcoded its own and ignored the `model` field entirely —
 * sending an invented model id still returned a reply, which is how we found
 * out. It ignored `max_tokens` too, so neither the model nor the cost ceiling
 * was ours to set.
 *
 * Sonnet 5 rather than Opus: this is a front desk answering in one to three
 * sentences, and the questions with fixed answers never reach a model at all.
 */
export const JADE_MODEL = "claude-sonnet-5";

/**
 * Thinking off, effort low.
 *
 * Sonnet 5 thinks by default, and for a chat bubble that is latency somebody
 * watches — the reply is short and the hard questions are answered from the
 * table before this is reached. Sonnet 5 also rejects a non-default
 * temperature outright, so tone is steered from the prompt and nowhere else.
 */
export const JADE_MAX_TOKENS = 400;

/** Where the model call goes when we have no key of our own. */
export const CHAT_PROXY_URL = "https://ms-chat-proxy.vercel.app/api/chat";
export const CHAT_CUSTOMER_URL = "https://ms-chat-proxy.vercel.app/api/customer";

/**
 * How many model-backed questions one person gets in a day.
 *
 * Was fifteen, and a visitor hit it on their second message — "naber",
 * "nasilsin", and then a form letter telling them to come back tomorrow. That
 * was the cheap path protecting a bill that came to three cents a month.
 *
 * Eighty is an abuse ceiling, not a budget: far past any real conversation and
 * still trivial against the rate limit on the route, which is the control that
 * actually stops a script.
 */
export const MAX_MODEL_MESSAGES_PER_DAY = 80;

export type Language = "tr" | "en";

/**
 * The prompt, and it is short on purpose.
 *
 * The version this replaces carried a full site map, a symptom-to-page table
 * and, on every request, seven hundred characters scraped live from each of
 * six pages. That last part was the expensive half of a widget built to be
 * cheap: six fetches per conversation and several thousand tokens of prompt
 * per message, to tell the model things the routing table below already knows
 * exactly. The scrape is gone.
 */
export const JADE_SYSTEM_PROMPT = [
  "You are Jade, the front desk for Minimum Stress (minimumstress.com).",

  "WHO YOU ARE:",
  "- Jade. Never say you are an AI, a bot, or a model.",
  "- Calm, brief, useful. One to three sentences. No filler, no repeated greeting.",
  "- Every reply should answer, route, or ask one useful question.",

  "HOW TO TALK:",
  "- Greet somebody who greets you, warmly and in one line, then ask what they are after.",
  "- When somebody is vague, ask one specific question rather than listing everything you could do. 'What are you planning to use it for?' beats a menu.",
  "- Use what they already told you. If they said they teach yoga on Tuesdays, do not ask again what they do.",
  "- Answer the question that was asked before you offer the next step.",
  "- If they say something is not what they meant, drop it and follow them. Never repeat a suggestion they turned down.",
  "- Compliments, small talk and jokes get a short human reply, then one useful question.",
  "- Never end on a dead stop. Leave them something to answer or somewhere to go.",

  "WHAT MINIMUM STRESS IS:",
  "- A marketplace for studios and private workout and session spaces. People book the hours they need; hosts open up the hours their space is standing empty.",
  "- Nobody is letting a home, a flat or a room in a house, and nobody signs a lease. What is bought and sold is an hour in a working space. Say 'studio' or 'space', not 'room'.",
  "- A booking is one hour. Somebody who needs longer books consecutive hours. There is no daily rate, no weekly rate, no monthly rate and no lease — never offer one.",
  "- Spaces are used for professional work: private client sessions, yoga and Pilates and movement, meditation and breathwork, coaching and consultation, small group classes and workshops.",
  "- It is for practitioners and professionals working with their own clients, students or groups.",
  "- We also publish free self-scored assessments.",

  "WHAT IT IS NOT:",
  "- We do not sell products and have no shop.",
  "- We do not match anybody with a coach, consultant or practitioner, and we do not employ any. Never offer to find someone a professional.",
  "- We do not own the rooms and provide no medical or health service. Never diagnose.",
  "- Never use the word 'therapy'.",

  "BOOKING, IN ORDER:",
  "1. Find a space and pick a time.",
  "2. Say what you will use it for and how many people are coming. This is required, and it is what a host sees.",
  "3. Pay. On a room where the host accepts bookings themselves, the card is held and the money is only taken if they accept.",
  "4. Entry details arrive before the session.",

  "NEVER ALLOWED IN A SPACE:",
  "- Illegal activity, sexual services, adult-content production, parties, and anything unsafe.",
  "- Any use different from the one declared, or more people than were declared.",
  "- If somebody asks whether one of these is allowed, say plainly that it is not.",

  "HOSTS:",
  "- A host runs a studio, a treatment space or a practice room of their own and opens its empty hours. They set their own rate and choose which uses they allow.",
  "- They can approve each request themselves or let matching bookings through.",
  "- Send them to the quote calculator to see what a room could earn.",

  "MONEY — REFUSE:",
  "- Never state or estimate our fee, our percentage, our margin, or what we make on a booking.",
  "- Never discuss commissions, our costs, our suppliers, our infrastructure, or how the platform is built.",
  "- If asked, say the price on a listing is the total the guest pays and the host keeps their rate, then move on.",

  "LINKS — use markdown, and only these:",
  "- Find a space: /spaces",
  "- List a space: /rent-out-your",
  "- How hosting works: /for-hosts",
  "- Questions: /faq",
  "- Trust and safety: /trust",
  "- Assessments: /assessments",
  "- Contact: /contact",

  "RULES:",
  "- One next step per reply unless somebody asks for options.",
  "- Never invent a page, a price, a policy or a feature. If you do not know, say so and point at /contact.",
  /*
   * Added after it told somebody to \"search Berkeley with piano as a filter\".
   * There is no amenity filter on /spaces. Inventing a control is worse than
   * inventing a fact: the person goes looking for it, does not find it, and
   * concludes the site is broken rather than that the answer was wrong.
   */
  "- Never describe a filter, button, field or setting unless you were told above that it exists. Say what is on a listing and let people read it; do not tell anybody to filter or search by something.",
  "- If somebody sounds unsafe or in crisis, respond with care and point at emergency services.",

  /*
   * Last, and handed again by the route with the language filled in.
   *
   * It used to sit at the top under LANGUAGE, and "hello" came back in
   * Turkish — buried in the middle of a long prompt, a rule about form loses
   * to every rule about content that follows it. The final line is the one a
   * model weights hardest, so this is the final line.
   */
  "TURKISH, WHEN YOU WRITE IT:",
  "- Address one person as 'sen' and stay there. Never drift into 'siz' halfway through a reply.",
  "- Write Turkish, not translated English. Check the case endings: 'kendi odan yoksa', not 'kendi odana yoksa'. 'Orayı da kullanabilirsin', not 'orası da kullanabilirsiniz'.",
  "- Say 'stüdyo', 'çalışma alanı' or 'alan'. Do not say 'oda' — it makes this sound like a room in somebody's house.",
  "- Say 'mekân sahibi', never 'ev sahibi'. Nobody here is letting a home.",
  "- Say 'saat ayırtmak' or 'rezervasyon yapmak'. 'Kiralamak' on its own suggests a lease; if you use it, say 'saatlik kiralamak'.",
  "- The two sides are 'misafir' and 'mekân sahibi'. Never coin a third — there is no such thing as 'alan olmak'.",
  "- 'Seans' for a session, 'rezervasyon' for a booking, 'fiyat' for a rate — never 'oran', which is a translation rather than a word anybody says.",

  "LANGUAGE — this overrides everything above:",
  "- Reply in the same language as the visitor's most recent message, and nothing else.",
  "- English in, English out. Turkish in, Turkish out. Never switch on your own.",
  "- Turkish must read as Turkish, not as translated English. Never correct anyone's language.",
].join("\n");

/**
 * The chips under the first message. Four.
 *
 * Six read as a menu, which is the thing a chat is supposed to save somebody
 * from. These are the four journeys the site has: come in as a guest, come in
 * as a host, find out what is allowed, or reach a person.
 *
 * They go to the model like anything else — a chip is an opening prompt, not a
 * shortcut to a canned paragraph, so the reply reads the conversation rather
 * than reciting a fixed one.
 */
/**
 * The language, stated as a fact rather than left to be inferred.
 *
 * Appended per request by the API route. The prompt already asks the model to
 * match the visitor and it still answered "hello" in Turkish — a rule a model
 * has to apply is weaker than a fact it is handed, so the fact is handed over.
 */
export function languageDirective(language: Language): string {
  return language === "tr"
    ? "\n\nThe visitor is writing in Turkish. Reply in Turkish."
    : "\n\nThe visitor is writing in English. Reply in English, and in no other language.";
}

export const QUICK_REPLIES = [
  "Find a space",
  "List my space",
  "What can I book?",
  "Contact support",
] as const;

/**
 * The opening line.
 *
 * "How can I help today?" is what every widget on the internet says, and it
 * puts the work back on the visitor — they have to guess what this one is for
 * before they can ask it anything. Naming the three things she can actually do
 * is shorter to read and answers the question the greeting was asking.
 */
export const JADE_GREETING = "Hi, I'm Jade. How can I assist you today? 🌿";

export interface LocalAnswer {
  /** What Jade says. Markdown links are rendered. */
  en: string;
  tr: string;
  /** Starts a flow that collects an email before anything is sent onward. */
  intake?: "support" | "host_interest" | "email_signup";
}

/**
 * The answers worth writing down.
 *
 * Each of these is a question with one correct answer that does not change,
 * which is the test for belonging here: if a model would only ever paraphrase
 * this, the paraphrase is not worth what it costs.
 */
/**
 * The two things a model must not be trusted to answer.
 *
 * Everything else went back to the model. The table started as a token-saving
 * device and became the product's voice: canned paragraphs, the same wording
 * every time, no memory of what was just said — a visitor asked "naber" and
 * got a form letter. It was optimising the wrong thing. The whole month of
 * traffic cost three cents; intelligence was never the expensive part.
 *
 * What stays is where being wrong actually costs somebody. A prohibited use
 * has one answer and a generative one can be talked into a maybe. A price has
 * one answer and the model invented a daily rate when it was left to infer
 * one. Neither is a conversation.
 */
const ROUTES: { match: readonly string[]; answer: LocalAnswer }[] = [
  {
    match: ["party", "parties", "sexual", "escort", "adult", "porn", "parti", "seks"],
    answer: {
      en: "No — parties, sexual services and adult-content production are not allowed in any space here, and a booking that misrepresents its purpose is ended. [Trust and safety](/trust).",
      tr: "Hayır — partiler, cinsel hizmetler ve yetişkin içerik üretimi buradaki hiçbir mekânda kabul edilmiyor, amacını yanlış beyan eden rezervasyon iptal edilir. [Güven ve güvenlik](/trust).",
    },
  },
  {
    match: [
      "how long", "how many hours", "per hour", "hourly", "daily rate", "per day",
      "kac saat", "kaç saat", "saatlik", "gunluk", "günlük", "ne kadar sure", "ne kadar süre",
    ],
    answer: {
      en: "A booking is one hour. If you need longer, take the hours next to each other. There is no daily or weekly rate and no lease — you pay for the hours you book and nothing else.",
      tr: "Bir rezervasyon bir saat. Daha uzun süre gerekiyorsa yan yana saatleri ayırtırsın. Günlük ya da haftalık fiyat yok, kira sözleşmesi de yok — sadece ayırttığın saati ödersin.",
    },
  },
  {
    match: [
      "cancel", "refund", "complaint", "problem", "not working", "charged",
      "iptal", "iade", "sikayet", "şikayet", "sorun",
    ],
    answer: {
      en: "I'm sorry about that 💙 Share your email and one line about what happened, and I'll pass it to the team. You can also write to info@minimumstress.com.",
      tr: "Bunu yaşadığın için üzgünüm 💙 E-postanı ve kısaca ne olduğunu yazarsan ekibe iletirim. info@minimumstress.com adresine de yazabilirsin.",
      intake: "support",
    },
  },
  {
    match: [
      "newsletter", "email list", "mailing list", "subscribe",
      "mail listesi", "listeye ekle", "listene ekle", "bulten", "bülten",
    ],
    answer: {
      en: "Happily 🌿 Which email address should I use?",
      tr: "Memnuniyetle 🌿 Hangi e-posta adresini kullanayım?",
      intake: "email_signup",
    },
  },
];

/**
 * Which language to answer in.
 *
 * Two signals, because the letters alone are not enough. Turkish written
 * without them is ordinary — "sen ne ise yariyorsun" has no ı, ş or ğ — and a
 * list of nouns misses every sentence that is a question rather than a
 * request. Greetings are in the list by name because "naber" has no Turkish
 * letter, no verb ending, and no other word to match on.
 *
 * Words are matched whole: "var" inside "variable" and "bir" inside "bird"
 * would otherwise answer an English question in Turkish.
 */
const TURKISH_WORDS = [
  "naber", "nabersin", "nasilsin", "nasılsın", "selam", "merhaba",
  "napiyorsun", "napıyorsun", "gunaydin", "günaydın",
  "sen", "ben", "biz", "siz", "ne", "neden", "niye", "nedir", "nasil", "nasıl",
  "kim", "hangi", "nerede", "icin", "için", "ile", "bir", "cok", "çok", "daha",
  "gibi", "kadar", "sonra", "once", "önce", "ama", "veya", "degil", "değil",
  "yok", "var", "mi", "mı", "mu", "mü", "misin", "mısın", "musun", "lazim",
  "lazım", "gerek", "istiyorum", "tesekkur", "teşekkür",
  "mekan", "mekân", "oda", "yer", "kirala", "rezervasyon", "iptal", "iade",
  "sikayet", "şikayet", "destek", "yardim", "yardım", "ucretsiz", "ücretsiz",
];

/** -yorum, -yorsun, -iyor, -mek, -dir: endings English does not have. */
const TURKISH_ENDINGS =
  /\\w+(yorum|yorsun|yoruz|iyor|ıyor|uyor|üyor|mek|mak|malı|meli|dir|dır|lar|ler)\\b/;

export function detectLanguage(text: string): Language {
  const raw = String(text || "");
  if (/[ğüşöçıİĞÜŞÖÇ]/.test(raw)) return "tr";

  const t = raw.toLowerCase();
  if (TURKISH_ENDINGS.test(t)) return "tr";

  const words = t.split(/[^a-zçğıöşü]+/).filter(Boolean);
  return words.some((word) => TURKISH_WORDS.includes(word)) ? "tr" : "en";
}

/**
 * The routing table, tried before the model.
 *
 * First match wins and the order above is the priority: the prohibited-use
 * answer sits last only because its words are distinctive enough not to catch
 * anything else. Returns null when nobody wrote an answer, which is the case
 * the model exists for.
 */
export function answerLocally(text: string): LocalAnswer | null {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;

  for (const route of ROUTES) {
    if (route.match.some((phrase) => t.includes(phrase))) return route.answer;
  }
  return null;
}

export function extractEmail(text: string): string {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

/** "no", "not now", "hayır" — enough to stop an intake without an argument. */
export function isDecline(text: string): boolean {
  const t = String(text || "").toLowerCase().trim().replace(/\s+/g, " ");
  return [
    "no", "nope", "no thanks", "not now", "later", "cancel", "stop", "skip",
    "nevermind", "never mind", "hayır", "hayir", "yok", "istemiyorum",
    "gerek yok", "şimdi değil", "simdi degil", "sonra", "iptal", "vazgeçtim",
  ].includes(t);
}
