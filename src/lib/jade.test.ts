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
 * Jade answers with the model. The table is a safety rail, not a script.
 *
 * It began as a token-saving device and quietly became the product's voice —
 * canned paragraphs, identical wording every time, no memory of the previous
 * message. Somebody said "naber" and got a form letter. The whole month of
 * traffic cost three cents, so it was optimising the wrong thing.
 *
 * What is left is where being wrong costs somebody something: a prohibited
 * use, a price, and the two flows that need an email before anything is sent
 * onward. Everything else is the model's, and these tests hold the prompt to
 * carrying the facts it now has to answer from.
 */

describe("what is still not the model's to answer", () => {
  /* A generative answer can be talked into a maybe. This one cannot. */
  it("refuses a prohibited use from the rule, in both languages", () => {
    const party = answerLocally("can I have a party there");
    expect(party?.en).toMatch(/not allowed|no —/i);
    expect(party?.tr).toContain("Hayır");
  });

  /* It invented a daily rate when this was left to inference. */
  it("states the session length and that there is no daily rate", () => {
    const hours = answerLocally("gunluk fiyat var mi");
    expect(hours?.tr).toContain("bir saat");
    expect(hours?.tr).toContain("Günlük ya da haftalık fiyat yok");
    expect(hours?.en).toContain("one hour");
  });

  it("collects an email before passing anything to the team", () => {
    expect(answerLocally("I need a refund")?.intake).toBe("support");
    expect(answerLocally("add me to the mailing list")?.intake).toBe("email_signup");
  });
});

describe("what goes to the model now", () => {
  it.each([
    "naber",
    "hello",
    "what is minimum stress",
    "find a space",
    "can I teach a class here",
    "oda mi alan mi",
    "do you have anywhere with a piano in Berkeley",
  ])("hands %s to the model rather than a canned reply", (question) => {
    expect(answerLocally(question), question).toBeNull();
  });

  /* The chips are prompts, not shortcuts to a script. */
  it("sends the quick replies to the model too", () => {
    for (const chip of QUICK_REPLIES) {
      expect(answerLocally(chip), chip).toBeNull();
    }
  });
});

/**
 * The prompt has to carry what the deleted answers used to say, or removing
 * them just moved the inventions back in.
 */
describe("the facts the model answers from", () => {
  const prompt = JADE_SYSTEM_PROMPT.toLowerCase();

  it("says what the business is and what it is not", () => {
    expect(prompt).toContain("marketplace for studios");
    expect(prompt).toContain("no shop");
    expect(prompt).toContain("never offer to find someone a professional");
    expect(prompt).toContain("nobody signs a lease");
  });

  it("carries the booking mechanics", () => {
    expect(prompt).toContain("a booking is one hour");
    expect(prompt).toContain("no daily rate");
    expect(prompt).toContain("say what you will use it for");
  });

  it("carries the prohibited uses", () => {
    expect(prompt).toContain("sexual services");
    expect(prompt).toContain("parties");
  });

  it("refuses the fee, the margin and the plumbing", () => {
    expect(prompt).toContain("never state or estimate our fee");
    expect(prompt).toContain("margin");
    expect(prompt).toContain("infrastructure");
  });

  it("never says therapy, and is told not to", () => {
    expect(prompt).toContain("never use the word 'therapy'");
  });

  it("gives the Turkish vocabulary, so a translation cannot drift", () => {
    expect(JADE_SYSTEM_PROMPT).toContain("Do not say 'oda'");
    expect(JADE_SYSTEM_PROMPT).toContain("never 'ev sahibi'");
    expect(JADE_SYSTEM_PROMPT).toContain("Address one person as 'sen' and stay there");
  });

  /* It told somebody to filter /spaces by piano. There is no such filter. */
  it("forbids describing a control it was not told exists", () => {
    expect(JADE_SYSTEM_PROMPT).toContain("Never describe a filter, button, field or setting");
  });

  it("tells her how to talk, not just what to say", () => {
    expect(prompt).toContain("greet somebody who greets you");
    expect(prompt).toContain("ask one specific question");
    expect(prompt).toContain("use what they already told you");
  });

  it("points only at routes that exist", () => {
    const paths = JADE_SYSTEM_PROMPT.match(/\/[a-z-]+(?=\s|$)/gm) ?? [];
    const real = ["/spaces", "/rent-out-your", "/for-hosts", "/faq", "/trust", "/assessments", "/contact"];
    for (const path of paths) {
      expect(real, `${path} is not a route`).toContain(path);
    }
  });

  it("carries no Shopify paths", () => {
    for (const dead of ["/pages/", "/collections/", "/blogs/"]) {
      expect(JADE_SYSTEM_PROMPT, dead).not.toContain(dead);
    }
  });
});

/**
 * "hello" came back in Turkish once. The language rule was at the top of the
 * prompt, under sixty lines about rooms — a rule about *how* to answer loses
 * to every rule about *what* to answer that follows it.
 */
describe("the language instruction", () => {
  it("is the last thing in the prompt", () => {
    const lines = JADE_SYSTEM_PROMPT.trim().split("\n").filter(Boolean);
    const heading = lines.findIndex((line) => line.startsWith("LANGUAGE"));
    expect(heading).toBeGreaterThan(-1);
    for (const line of lines.slice(heading + 1)) {
      expect(line.startsWith("-"), `"${line}" follows the language rule`).toBe(true);
    }
  });

  it("names the language rather than asking the model to work it out", () => {
    expect(languageDirective("en")).toContain("Reply in English");
    expect(languageDirective("tr")).toContain("Reply in Turkish");
    expect((JADE_SYSTEM_PROMPT + languageDirective("en")).trim()).toMatch(/no other language\.$/);
  });
});

describe("reading the visitor", () => {
  it.each([
    "naber",
    "nasilsin",
    "selam",
    "sen ne ise yariyorsun",
    "bir oda ariyorum",
    "mekanimi listelemek istiyorum",
  ])("reads %s as Turkish", (line) => {
    expect(detectLanguage(line)).toBe("tr");
  });

  it.each([
    "hello",
    "what can I book a space for",
    "is there a variable rate",
    "do you have anything in Berkeley",
  ])("leaves %s in English", (line) => {
    expect(detectLanguage(line)).toBe("en");
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

describe("the opening line", () => {
  it("asks rather than announces", () => {
    expect(JADE_GREETING).toContain("How can I assist you today");
  });
});
