/**
 * Jade, the front desk — what she knows and what she can answer without asking.
 *
 * The widget this came from ran on Shopify and was cheap to run for one
 * reason worth keeping: most of what people ask a front desk is routing, and
 * routing does not need a model. `answerLocally` below handles the common
 * intents from a lookup table and never touches the API. Only a genuine
 * question — something nobody wrote an answer for — costs a call.
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

/** Where the model call goes. Public endpoint; the key lives on that side. */
export const CHAT_PROXY_URL = "https://ms-chat-proxy.vercel.app/api/chat";
export const CHAT_CUSTOMER_URL = "https://ms-chat-proxy.vercel.app/api/customer";

/**
 * How many model-backed questions one person gets in a day.
 *
 * Local answers are free and are not counted — somebody can route themselves
 * around the site all afternoon. The cap is on the expensive path only.
 */
export const MAX_MODEL_MESSAGES_PER_DAY = 15;

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

  "LANGUAGE:",
  "- Reply in the language of the visitor's latest message. Turkish in, Turkish out.",
  "- Write natural Turkish, not translated English. Never correct anyone's language.",

  "WHO YOU ARE:",
  "- Jade. Never say you are an AI, a bot, or a model.",
  "- Calm, brief, useful. One to three sentences. No filler, no repeated greeting.",
  "- Every reply should answer, route, or ask one useful question.",

  "WHAT MINIMUM STRESS IS:",
  "- A marketplace for private wellness space. People book a room for the time they need; hosts list a room they already have.",
  "- Rooms are used for personal practice, dance and movement rehearsal, yoga and Pilates, meditation and breathwork, private client sessions, coaching, small group classes and workshops.",
  "- It is for anybody, not only professionals. Two friends who want a floor to rehearse on are exactly the point.",
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
  "- A host sets their own rate, their own hours, and chooses which uses they allow.",
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
  "- If somebody sounds unsafe or in crisis, respond with care and point at emergency services.",
].join("\n");

/**
 * The chips under the first message. Four.
 *
 * Six read as a menu, which is the thing a chat is supposed to save somebody
 * from — a wall of options is a worse version of the navigation they already
 * scrolled past. These are the four journeys the site actually has: come in as
 * a guest, come in as a host, find out what is allowed, or get a person.
 *
 * Every one of them is answered by the table in this file, so the opening move
 * costs nothing whichever chip is pressed. A test asserts that.
 */
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
export const JADE_GREETING =
  "Hi, I'm Jade 🌿 I can help you find a space, list your space, or answer questions about booking.";

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
const ROUTES: { match: readonly string[]; answer: LocalAnswer }[] = [
  {
    match: [
      "find a space", "book a space", "find a room", "book a room", "browse",
      "mekan bul", "oda bul", "yer bul", "kiralamak",
    ],
    answer: {
      en: "Have a look at [what is available](/spaces) 🌿 You can filter by the kind of room and the time you need. What are you planning to use it for?",
      tr: "[Açık olan mekânlara](/spaces) göz atabilirsin 🌿 Oda tipine ve ihtiyacın olan saate göre filtreleyebilirsin. Ne için kullanmayı düşünüyorsun?",
    },
  },
  {
    match: [
      "what can i book", "what can i use", "allowed", "can i do", "what for",
      "ne icin kullan", "ne için kullan", "izin var", "yapabilir miyim",
    ],
    answer: {
      en: "It depends on the room and what the host allows — personal practice, dance or movement rehearsal, yoga and Pilates, meditation, private client sessions, coaching, small groups and workshops are all normal. You say what you are planning before you book. [What is available](/spaces).",
      tr: "Odaya ve ev sahibinin izin verdiğine bağlı — kişisel çalışma, dans veya hareket provası, yoga ve Pilates, meditasyon, birebir danışan görüşmesi, koçluk, küçük gruplar ve atölyeler normal kullanımlar. Rezervasyondan önce ne yapacağını yazıyorsun. [Açık mekânlar](/spaces).",
    },
  },
  {
    match: [
      "list my space", "list a space", "rent out", "become a host", "i have a space",
      "i have a room", "host", "mekanimi", "mekânımı", "oda kiraya", "ev sahibi",
    ],
    answer: {
      en: "Good — [see what your space could earn](/rent-out-your) with your own rate and hours 🌿 You choose which uses you allow and whether you approve each booking yourself. [How hosting works](/for-hosts).",
      tr: "Güzel — kendi fiyatın ve saatlerinle [mekânının ne kazanabileceğine](/rent-out-your) bakabilirsin 🌿 Hangi kullanımlara izin vereceğine ve her rezervasyonu kendin onaylayıp onaylamayacağına sen karar veriyorsun. [Ev sahipliği nasıl işliyor](/for-hosts).",
      intake: "host_interest",
    },
  },
  {
    match: [
      "how does booking work", "how do i book", "how it works", "booking work",
      "nasil rezervasyon", "nasıl rezervasyon", "nasil calisiyor", "nasıl çalışıyor",
    ],
    answer: {
      en: "Pick a space and a time, say what you will use it for and how many are coming, then pay. On rooms where the host accepts bookings themselves, your card is held and only charged if they accept. Entry details reach you before the session. More in the [questions](/faq).",
      tr: "Bir mekân ve saat seç, ne için kullanacağını ve kaç kişi olacağınızı yaz, sonra öde. Ev sahibinin kendisi onayladığı odalarda kartın bloke edilir ve yalnızca kabul ederse çekilir. Giriş bilgileri seanstan önce sana ulaşır. Detaylar [sorularda](/faq).",
    },
  },
  {
    match: [
      "assessment", "test", "quiz", "burnout", "sleep score", "cortisol",
      "degerlendirme", "değerlendirme", "tükenmişlik", "tukenmislik", "uyku",
    ],
    answer: {
      en: "The [assessments](/assessments) are free and scored on the screen — nothing is stored and no account is needed. Burnout, sleep, stress, gut health and a few others.",
      tr: "[Değerlendirmeler](/assessments) ücretsiz ve ekranda puanlanıyor — hiçbir şey saklanmıyor, hesap da gerekmiyor. Tükenmişlik, uyku, stres, bağırsak sağlığı ve birkaç tane daha.",
    },
  },
  {
    match: [
      "safe", "safety", "trust", "verified", "secure",
      "guvenli", "güvenli", "guven", "güven",
    ],
    answer: {
      en: "Everybody says what they are booking a space for before they pay, and hosts choose which uses they allow — that is the core of it. [Trust and safety](/trust) has the rest.",
      tr: "Herkes ödemeden önce mekânı ne için kullanacağını yazıyor ve ev sahipleri hangi kullanımlara izin vereceklerini kendileri seçiyor — işin özü bu. Gerisi [güven ve güvenlik](/trust) sayfasında.",
    },
  },
  {
    match: [
      "cancel", "refund", "complaint", "problem", "not working", "support", "charged",
      "iptal", "iade", "sikayet", "şikayet", "sorun", "destek", "yardim", "yardım",
    ],
    answer: {
      en: "I'm sorry about that 💙 Share your email and one line about what happened, and I'll pass it to the team. You can also write to info@minimumstress.com.",
      tr: "Bunu yaşadığın için üzgünüm 💙 E-postanı ve kısaca ne olduğunu yazarsan ekibe iletirim. info@minimumstress.com adresine de yazabilirsin.",
      intake: "support",
    },
  },
  {
    match: [
      "newsletter", "email list", "mailing list", "subscribe", "updates",
      "mail listesi", "listeye ekle", "listene ekle", "bulten", "bülten",
    ],
    answer: {
      en: "Happily 🌿 Which email address should I use?",
      tr: "Memnuniyetle 🌿 Hangi e-posta adresini kullanayım?",
      intake: "email_signup",
    },
  },
  {
    match: ["what is minimum stress", "who are you", "about you", "minimum stress nedir", "kimsiniz", "nedir"],
    answer: {
      en: "We're a marketplace for private wellness space 🌿 People book a room for the time they need — to practise, rehearse, teach, or see their own clients — and hosts list a room they already have. [Have a look](/spaces).",
      tr: "Özel wellness mekânları için bir pazar yeriyiz 🌿 İnsanlar ihtiyaç duydukları süre için bir oda kiralıyor — çalışmak, prova yapmak, ders vermek ya da kendi danışanlarını görmek için — ev sahipleri de ellerindeki odayı listeliyor. [Göz at](/spaces).",
    },
  },
  /*
   * Asked often, and the one place a wrong answer is expensive. Answered from
   * the rule rather than from the model, so it cannot be softened into a maybe.
   */
  {
    match: ["party", "parties", "sexual", "escort", "adult", "porn", "parti", "seks"],
    answer: {
      en: "No — parties, sexual services and adult-content production are not allowed in any space here, and a booking that misrepresents its purpose is ended. [Trust and safety](/trust).",
      tr: "Hayır — partiler, cinsel hizmetler ve yetişkin içerik üretimi buradaki hiçbir mekânda kabul edilmiyor, amacını yanlış beyan eden rezervasyon iptal edilir. [Güven ve güvenlik](/trust).",
    },
  },
];

/**
 * Which language to answer in.
 *
 * Two signals, because the first one alone was not enough. Turkish written
 * without its own letters is ordinary — "sen ne ise yariyorsun" has no ı, ş or
 * ğ in it — and a keyword list of nouns like "mekân" and "rezervasyon" misses
 * every sentence that is a question rather than a request. That one came back
 * in English.
 *
 * So: the letters, a set of function words that exist in Turkish and not in
 * English, and the verb endings. A sentence needs only one of them. The words
 * are matched whole, because "var" inside "variable" and "bir" inside "bird"
 * would otherwise answer an English question in Turkish.
 */
const TURKISH_WORDS = [
  "sen", "ben", "biz", "siz", "ne", "neden", "niye", "nedir", "nasil", "nasıl",
  "kim", "hangi", "nerede", "icin", "için", "ile", "bir", "cok", "çok", "daha",
  "gibi", "kadar", "sonra", "once", "önce", "ama", "veya", "degil", "değil",
  "yok", "var", "mi", "mı", "mu", "mü", "misin", "mısın", "musun", "lazim",
  "lazım", "gerek", "istiyorum", "merhaba", "selam", "tesekkur", "teşekkür",
  "mekan", "mekân", "oda", "yer", "kirala", "rezervasyon", "iptal", "iade",
  "sikayet", "şikayet", "destek", "yardim", "yardım", "ucretsiz", "ücretsiz",
];

/** -yorum, -yorsun, -iyor, -mek, -mak, -dir: endings English does not have. */
const TURKISH_ENDINGS =
  /\w+(yorum|yorsun|yoruz|iyor|ıyor|uyor|üyor|mek|mak|malı|meli|dir|dır|lar|ler)/;

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
