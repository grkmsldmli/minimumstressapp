import { describe, expect, it } from "vitest";

import {
  JADE_SYSTEM_PROMPT,
  QUICK_REPLIES,
  answerLocally,
  detectLanguage,
  extractEmail,
  isDecline,
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
