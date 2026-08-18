import { describe, expect, it } from "vitest";

import {
  JADE_GREETING,
  JADE_SYSTEM_PROMPT,
  QUICK_REPLIES,
  answerLocally,
  detectLanguage,
  extractEmail,
  isDecline,
  languageDirective,
} from "./jade";

/**
 * The front desk, held to what the business actually is.
 *
 * Jade came from a version of this company that sold sessions with
 * consultants and ran a shop. Most of the risk in porting her is that some of
 * that survives in a sentence nobody re-read — so these check the shape of
 * what she can say, not her wording.
 */

/*
 * What she can actually say: the chips, and every answer in the table.
 *
 * Checked apart from the prompt on purpose. The prompt has to name the things
 * she must not do — "we have no shop", "never use the word therapy" — so
 * scanning it for those words finds the prohibition and calls it a violation.
 * The prohibitions are tested for their presence further down instead.
 */
const SPOKEN = [
  QUICK_REPLIES.join(" "),
  ...[
    "find a space", "what can i book a space for", "list my space",
    "how does booking work", "free assessments", "contact support",
    "is it safe", "newsletter", "what is minimum stress", "party",
  ].flatMap((ask) => {
    const answer = answerLocally(ask);
    return answer ? [answer.en, answer.tr] : [];
  }),
]
  .join(" ")
  .toLowerCase();

describe("what Jade is no longer selling", () => {
  it("never offers a product or a shop", () => {
    /*
     * Whole words. "adult-content production" is in the answer that refuses
     * it, and a substring match on "product" reads that as a shop.
     */
    for (const gone of ["shop", "products", "herbal", "aromatherapy", "collection"]) {
      expect(SPOKEN, gone).not.toMatch(new RegExp(`\b${gone}\b`));
    }
  });

  /*
   * The rule the rest of the site is already held to: we let space, we do not
   * put anybody in front of a professional. An assistant offering to is worse
   * than a page saying it, because it sounds like a person promising.
   */
  it("never offers to find somebody a practitioner", () => {
    for (const gone of ["book a session with", "match you with", "our consultants", "our instructors"]) {
      expect(SPOKEN, gone).not.toContain(gone);
    }
  });

  it("never says therapy, and is told not to", () => {
    expect(SPOKEN).not.toContain("therap");
    expect(JADE_SYSTEM_PROMPT.toLowerCase()).toContain("never use the word 'therapy'");
  });

  it("is told there is no shop and nobody to be matched with", () => {
    const prompt = JADE_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("no shop");
    expect(prompt).toContain("never offer to find someone a professional");
  });

  it("points at pages that exist", () => {
    const paths = JADE_SYSTEM_PROMPT.match(/\/[a-z-]+(?=\s|$)/gm) ?? [];
    const real = ["/spaces", "/rent-out-your", "/for-hosts", "/faq", "/trust", "/assessments", "/contact"];
    for (const path of paths) {
      expect(real, `${path} is not a route`).toContain(path);
    }
  });

  /* The Shopify addresses the old prompt was built from. */
  it("carries no Shopify paths", () => {
    for (const dead of ["/pages/", "/collections/", "/blogs/"]) {
      expect(JADE_SYSTEM_PROMPT, dead).not.toContain(dead);
    }
  });
});

describe("the money rule", () => {
  it("tells her to refuse the fee, the margin and the plumbing", () => {
    const prompt = JADE_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("never state or estimate our fee");
    expect(prompt).toContain("margin");
    expect(prompt).toContain("infrastructure");
  });
});

describe("answering without the model", () => {
  it("routes the common asks from the table", () => {
    for (const ask of [
      "find a space", "list my space", "how does booking work",
      "free assessments", "is it safe", "I want a refund",
    ]) {
      expect(answerLocally(ask), ask).not.toBeNull();
    }
  });

  it("answers every quick reply without a network call", () => {
    for (const chip of QUICK_REPLIES) {
      expect(answerLocally(chip), chip).not.toBeNull();
    }
  });

  /*
   * The one answer that must never come from a model. "Can I throw a party
   * here" has a fixed answer, and a generative one can be talked into a maybe.
   */
  it("refuses a prohibited use from the rule, in both languages", () => {
    const party = answerLocally("can I have a party there");
    expect(party?.en).toMatch(/not allowed|no —/i);
    expect(party?.tr).toContain("Hayır");
  });

  it("hands back nothing for a real question, so the model gets it", () => {
    expect(answerLocally("do you have anywhere with a piano in Oakland")).toBeNull();
  });

  it("offers an intake only where somebody is waiting on a reply", () => {
    expect(answerLocally("I need a refund")?.intake).toBe("support");
    expect(answerLocally("find a space")?.intake).toBeUndefined();
  });
});

describe("reading the visitor", () => {
  it("spots Turkish by its letters and its words", () => {
    expect(detectLanguage("mekân arıyorum")).toBe("tr");
    expect(detectLanguage("nasil rezervasyon yapabilirim")).toBe("tr");
    expect(detectLanguage("I need a room on Tuesday")).toBe("en");
  });

  it("finds an email in a sentence", () => {
    expect(extractEmail("sure, it is ana@example.com thanks")).toBe("ana@example.com");
    expect(extractEmail("no thanks")).toBe("");
  });

  it("takes no for an answer in both languages", () => {
    for (const no of ["no", "not now", "hayır", "istemiyorum", "vazgeçtim"]) {
      expect(isDecline(no), no).toBe(true);
    }
    expect(isDecline("no idea where to start")).toBe(false);
  });
});

/**
 * Turkish that does not look Turkish.
 *
 * The first detector was a list of nouns — mekân, rezervasyon, şikayet — and
 * it read "sen ne ise yariyorsun" as English, because that sentence contains
 * no Turkish letters and asks a question rather than naming a thing. Somebody
 * writing without an ı on their keyboard got answered in the wrong language.
 */
describe("reading Turkish written plainly", () => {
  it.each([
    "sen ne ise yariyorsun",
    "burada ne yapabilirim",
    "bir oda ariyorum",
    "nasil calisiyor bu",
    "bana yardim eder misin",
    "mekanimi listelemek istiyorum",
  ])("reads %s as Turkish", (line) => {
    expect(detectLanguage(line)).toBe("tr");
  });

  /* And does not start answering English in Turkish. */
  it.each([
    "what can I book a space for",
    "I need a bigger room",
    "is there a variable rate",
    "do you have anything in Berkeley",
    "how many people fit",
  ])("leaves %s in English", (line) => {
    expect(detectLanguage(line)).toBe("en");
  });
});

/**
 * "hello" came back in Turkish.
 *
 * The language rule was at the top of the prompt, under a heading, followed by
 * sixty lines about rooms and prohibited uses — and a rule about *how* to
 * answer loses to every rule about *what* to answer that comes after it. It is
 * the last line now, and the route hands the detected language over as a fact
 * on top of that.
 */
describe("the language instruction", () => {
  it("is the last thing in the prompt", () => {
    const lines = JADE_SYSTEM_PROMPT.trim().split("\n").filter(Boolean);
    const heading = lines.findIndex((line) => line.startsWith("LANGUAGE"));
    expect(heading).toBeGreaterThan(-1);
    // Nothing but its own bullets may follow it.
    for (const line of lines.slice(heading + 1)) {
      expect(line.startsWith("-"), `"${line}" follows the language rule`).toBe(true);
    }
  });

  it("names the language rather than asking the model to work it out", () => {
    expect(languageDirective("en")).toContain("Reply in English");
    expect(languageDirective("tr")).toContain("Reply in Turkish");
  });

  it("puts it after everything else when the two are joined", () => {
    const full = JADE_SYSTEM_PROMPT + languageDirective("en");
    expect(full.trim().endsWith("in no other language.")).toBe(true);
  });
});

describe("how she talks", () => {
  /* The half the short prompt lost: it could route, but it could not converse. */
  it("is told to greet, to ask one question, and to follow the visitor", () => {
    const prompt = JADE_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("greet somebody who greets you");
    expect(prompt).toContain("ask one specific question");
    expect(prompt).toContain("use what they already told you");
    expect(prompt).toContain("never repeat a suggestion they turned down");
  });

  it("opens with a line that asks rather than announces", () => {
    expect(JADE_GREETING).toContain("How can I assist you today");
  });
});

/**
 * What a real conversation turned up.
 *
 * Somebody asked, in Turkish, whether they would be renting out their own
 * room. Jade said yes — "saatlik veya günlük olarak, sen belirlersin". There
 * is no daily rate. A booking is an hour, and she invented a pricing model on
 * a page about money, because the prompt said rooms are booked "for the time
 * they need" and left the model to fill the gap in.
 *
 * The same conversation drifted from 'sen' to 'siz' mid-answer, produced
 * "kendi odana yoksa" for "kendi odan yoksa", and coined "alan olmak" for
 * being a guest — a phrase that means nothing, in a language where "alan"
 * already means "space". The original widget had a Turkish-quality section
 * and the rewrite dropped it for length.
 */
describe("what she must not invent", () => {
  it("states the session length, so the model does not guess a daily rate", () => {
    const prompt = JADE_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("a booking is one hour");
    expect(prompt).toContain("no daily rate");
    expect(prompt).toContain("no lease");
  });

  it("fixes the Turkish register rather than leaving it to chance", () => {
    const prompt = JADE_SYSTEM_PROMPT;
    expect(prompt).toContain("Address one person as 'sen' and stay there");
    expect(prompt).toContain("Never drift into 'siz'");
  });

  it("gives her the words for both sides, so she coins none", () => {
    const prompt = JADE_SYSTEM_PROMPT;
    expect(prompt).toContain("ev sahibi");
    expect(prompt).toContain("misafir");
    expect(prompt).toContain("alan olmak");
  });
});

/**
 * The questions from that conversation, now answered from the table.
 *
 * Every one of them reached the model, and every one has a single correct
 * answer that does not change — which is the definition of something that
 * should never have been generated. "Saatlik veya günlük" was invented on the
 * way through, and "alan olmak" was coined out of nothing.
 */
describe("the questions that were being made up", () => {
  it.each([
    "ne ise yariyor burasi",
    "burasi ne",
    "ozel ders verebilir miyim",
    "oda mi alan mi",
    "kendi odami mi kiralicam",
    "kac saat kiralayabilirim",
    "gunluk fiyat var mi",
  ])("answers %s without asking a model", (question) => {
    expect(answerLocally(question), question).not.toBeNull();
  });

  it("says an hour, and says there is no daily rate", () => {
    const answer = answerLocally("gunluk fiyat var mi");
    expect(answer?.tr).toContain("bir saat");
    expect(answer?.tr).toContain("Günlük ya da haftalık fiyat yok");
    expect(answer?.en).toContain("one hour");
  });

  it("names the two sides with the words that exist", () => {
    const answer = answerLocally("oda mi alan mi");
    expect(answer?.tr).toContain("misafir");
    /*
     * "mekân sahibi", not "ev sahibi". The literal translation of host is
     * landlord, and beside "oda kiralamak" it described a room in somebody's
     * house on a lease — a different business entirely.
     */
    expect(answer?.tr).toContain("mekân sahibi");
    expect(answer?.tr).not.toContain("alan olmak");
  });

  /* Every written answer stays in one register, which the model did not. */
  it("never drifts from sen to siz in an answer we wrote", () => {
    for (const question of ["oda mi alan mi", "gunluk fiyat var mi", "ne ise yariyor burasi"]) {
      const tr = answerLocally(question)?.tr ?? "";
      expect(tr, question).not.toMatch(/\b(siniz|sınız|sunuz|sünüz)\b/);
    }
  });
});

/**
 * Nobody is letting a house.
 *
 * "Birinin odasını kiralıyorsun" and "ev sahibi" are the literal translations
 * of room and host, and together they describe a completely different
 * business — a room in somebody's home, on a lease. What is actually sold
 * here is an hour in a working studio.
 *
 * The English half of the prompt is where the Turkish came from, so both are
 * checked. "Room" survives only in the match lists, which are the words a
 * visitor might type at us rather than the words we say back.
 */
describe("the words for what this is", () => {
  const spoken = [
    ...[
      "find a space", "what can i book", "list my space", "how does booking work",
      "what is minimum stress", "oda mi alan mi", "kac saat", "is it safe",
    ].flatMap((ask) => {
      const answer = answerLocally(ask);
      return answer ? [answer.en, answer.tr] : [];
    }),
  ].join(" ");

  it("never calls it a room in Turkish", () => {
    expect(spoken).not.toMatch(/\bOda\b|\bodası\b|\bodayı\b|\bodanı\b/);
  });

  it("never calls a host a landlord", () => {
    expect(spoken).not.toContain("ev sahib");
  });

  it("says studio, space or alan instead", () => {
    expect(spoken).toMatch(/stüdyo|çalışma alanı|alan/i);
    expect(spoken).toMatch(/studio|space/i);
  });

  it("tells the model the same thing", () => {
    expect(JADE_SYSTEM_PROMPT).toContain("Do not say 'oda'");
    expect(JADE_SYSTEM_PROMPT).toContain("never 'ev sahibi'");
    expect(JADE_SYSTEM_PROMPT).toContain("Say 'studio' or 'space', not 'room'");
    expect(JADE_SYSTEM_PROMPT).toContain("nobody signs a lease");
  });
});

/**
 * Three things a real conversation broke.
 *
 * "assesment nedir" — one 's', which is how most people spell it — missed the
 * assessments route and fell through to a bare "nedir" in the company blurb,
 * so somebody asking what an assessment is was told what the company is.
 *
 * "sen kaç yaşındasın" and "sen kız mısın" each spent a model call, and the
 * visitor in that transcript used their whole daily allowance on small talk
 * before they could ask anything real.
 */
describe("what the table was missing", () => {
  it("knows how assessment is usually misspelled", () => {
    expect(answerLocally("assesment nedir")?.tr).toContain("Değerlendirmeler");
    expect(answerLocally("assessment nedir")?.tr).toContain("Değerlendirmeler");
  });

  /* "nedir" alone matched any Turkish "what is X" question at all. */
  it("no longer answers every 'what is' question with the company blurb", () => {
    expect(answerLocally("pilates nedir")).toBeNull();
    expect(answerLocally("burasi nedir")?.tr).toContain("pazar yeriyiz");
  });

  it.each([
    "kac yasindasin",
    "sen kiz misin",
    "insan misin",
    "are you a bot",
    "how old are you",
  ])("answers %s without a model call", (question) => {
    expect(answerLocally(question), question).not.toBeNull();
  });

  /*
   * She neither claims to be a person nor announces she is not one. The
   * business decided the first; the second is not hers to volunteer mid-chat.
   */
  it("turns the question back to what they came for", () => {
    const answer = answerLocally("sen kiz misin");
    expect(answer?.tr).toContain("Jade");
    expect(answer?.tr).toMatch(/alan/);
  });
});

/**
 * It told somebody to "search Berkeley with piano as a filter".
 *
 * There is no amenity filter on /spaces. Inventing a control is worse than
 * inventing a fact — the person goes looking for it, doesn't find it, and
 * concludes the site is broken rather than that the answer was wrong.
 */
describe("interface it must not invent", () => {
  it("is told not to describe filters or controls", () => {
    expect(JADE_SYSTEM_PROMPT).toContain("Never describe a filter, button, field or setting");
  });

  /* And our own written answers must not do it either. */
  it("never promises one in an answer we wrote", () => {
    for (const ask of ["find a space", "what can i book", "what is minimum stress"]) {
      const answer = answerLocally(ask);
      expect(answer?.en, ask).not.toMatch(/filter by (amenity|equipment|piano)/i);
    }
  });
});
