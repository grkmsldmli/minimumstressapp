import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  JADE_GREETING,
  JADE_HISTORY_MESSAGES,
  JADE_SYSTEM_PROMPT,
  QUICK_REPLIES,
  answerLocally,
  detectLanguage,
  extractEmail,
  isDecline,
  languageDirective,
} from "./jade";
import { SERVICE_AREA_NAME, SERVICE_COUNTRY } from "./service-area";

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

  it("sends a support question to a person, without promising a handoff it cannot do", () => {
    const refund = answerLocally("I need a refund");
    // It points to the real channel and never claims to forward or file anything.
    expect(refund?.en).toContain("(/contact)");
    expect(refund?.en).not.toMatch(/pass it|to the team|forward|escalate|open a ticket/i);
    expect(refund?.tr).not.toMatch(/ilet|yönlendir/i);
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

  it("uses only real routes, and only as markdown links with word labels", () => {
    const real = ["/spaces", "/rent-out-your", "/for-hosts", "/faq", "/trust", "/assessments", "/contact"];

    // Every link target the model is shown must be a route that exists.
    const targets = [...JADE_SYSTEM_PROMPT.matchAll(/\]\((\/[a-z-]+)\)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const path of targets) {
      expect(real, `${path} is not a route`).toContain(path);
    }

    // And no link is left showing the raw path as its label — the "[/spaces]"
    // bug — anywhere except the single line that teaches the model to avoid it.
    const withoutTheLesson = JADE_SYSTEM_PROMPT.split("\n")
      .filter((line) => !line.includes("is wrong and reads as broken"))
      .join("\n");
    expect(withoutTheLesson).not.toMatch(/\[\/[a-z-]+\]/);
  });

  it("carries no Shopify paths", () => {
    for (const dead of ["/pages/", "/collections/", "/blogs/"]) {
      expect(JADE_SYSTEM_PROMPT, dead).not.toContain(dead);
    }
  });
});

/**
 * The weak conversation, turned into fixtures.
 *
 * A real transcript went in circles: it did not know which country it was in,
 * printed a link as "[/spaces](/spaces)", asked for a town it was never given
 * three times, and recited the booking steps at somebody who only wanted a
 * yoga space. The model is not run here, so each regression is held at the one
 * place it is fixable — the facts and rules the prompt now carries.
 */
describe("the weak conversation, guarded in the prompt", () => {
  const prompt = JADE_SYSTEM_PROMPT.toLowerCase();

  it("knows which country and area it operates in, rather than deflecting", () => {
    // "which country are you in?" → the United States, currently the Bay Area.
    expect(prompt).toContain("the united states");
    expect(prompt).toContain("the san francisco bay area");
    expect(prompt).toContain("never say you are not sure where the company operates");
  });

  it("is drawn from the canonical service-area source, not a hardcoded string", () => {
    // The wording comes from lib/service-area.ts, so the area cannot drift from
    // the boundary the app enforces at listing time.
    expect(JADE_SYSTEM_PROMPT).toContain(SERVICE_AREA_NAME);
    expect(JADE_SYSTEM_PROMPT).toContain(SERVICE_COUNTRY);
  });

  it("says yes to a town inside the area instead of sending it to Contact", () => {
    // "Is this available in San Francisco?" → yes, that is in our area.
    expect(prompt).toContain("that is in our area");
  });

  it("answers first and keeps it short, not a recited process", () => {
    expect(prompt).toContain("answer first");
    expect(prompt).toContain("one to three short sentences");
    expect(prompt).toContain("do not walk through the whole booking process unless they ask");
  });

  it("makes a space request answer-first, never a leading 'which town?'", () => {
    // The B regression: it opened "I need a yoga space for 5" with a question
    // instead of the capacity fact and a browse link.
    expect(prompt).toContain("when somebody wants a space");
    expect(prompt).toContain("answer first, with something useful, before any question");
    expect(prompt).toContain("never open a space request with 'which town?'");
  });

  it("remembers what was said and does not ask the same thing twice", () => {
    expect(prompt).toContain("remember everything said in this conversation");
    expect(prompt).toContain("never ask for the town more than once");
    expect(prompt).toContain("ask at most one clarifying question");
  });

  it("lets a group booker see capacity rather than inventing a filter", () => {
    expect(prompt).toContain("every listing shows its capacity");
  });

  it("does not funnel every uncertain question to support", () => {
    expect(prompt).toContain("do not send every uncertain question to support");
    expect(prompt).toContain("only when a person is actually needed");
  });

  it("gives links a human label and never the raw path", () => {
    expect(JADE_SYSTEM_PROMPT).toContain("[find a space](/spaces)");
    expect(JADE_SYSTEM_PROMPT).toContain("[contact support](/contact)");
    // The counter-example the model is warned against.
    expect(JADE_SYSTEM_PROMPT).toContain("[/spaces](/spaces) is wrong");
  });
});

/**
 * How far back she can remember.
 *
 * A live conversation forgot a detail from its first message by the sixth,
 * because the window was six. Twelve is the shared cap the widget and the route
 * both trim to — one number, tested here so a drift in either is caught.
 */
describe("conversation memory window", () => {
  it("shows the model the last twelve messages, not six", () => {
    expect(JADE_HISTORY_MESSAGES).toBe(12);
  });
});

/**
 * The rename, and the promise she is no longer allowed to make.
 *
 * The assistant is Luna to anyone reading; the internal names stay Jade to keep
 * the change to the surface. And there is no support inbox behind this widget,
 * so the one thing she must never do is say she will pass something on.
 */
describe("Luna, and the honest handoff", () => {
  it("introduces herself as Luna, with no Jade left in what a visitor reads", () => {
    expect(JADE_GREETING).toContain("Luna");
    expect(JADE_GREETING).not.toContain("Jade");
    expect(JADE_SYSTEM_PROMPT).toContain("You are Luna");
    // The prompt is spoken as her, so the old name must be gone from it entirely.
    expect(JADE_SYSTEM_PROMPT).not.toContain("Jade");
  });

  it("forbids the model from claiming any handoff it cannot perform", () => {
    const prompt = JADE_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("you cannot send, forward, escalate, or file anything");
    expect(prompt).toContain("there is no ticket system");
    expect(prompt).toContain("never say you will pass a message on");
  });

  it("never claims a mailing-list signup succeeded, because none can", () => {
    // There is no newsletter backend. Every phrasing that reaches the table
    // must say it cannot, and none may imply success.
    for (const phrase of ["add me to the mailing list", "newsletter", "subscribe me", "mail listesi"]) {
      const answer = answerLocally(phrase);
      expect(answer, phrase).not.toBeNull();
      expect(answer?.en.toLowerCase(), phrase).toContain("can't add you to a mailing list");
      expect(answer?.en, phrase).not.toMatch(
        /subscribed|added you|you're on the list|you are on the list|passed .* to the team/i,
      );
      expect(answer?.tr, phrase).not.toMatch(/eklendin|abone oldun|listeye ekledim|ilettim/i);
    }
  });
});

/**
 * The old Shopify proxy, gone for good.
 *
 * Every model answer once fell back to `ms-chat-proxy.vercel.app/api/chat` when
 * no key was set, and every "lead" was forwarded to its `/api/customer`. The
 * new platform must not depend on either, so this reads the source and proves
 * the dependency is not just unused but absent — a reference re-added later
 * fails here rather than in production.
 */
describe("no Luna flow depends on ms-chat-proxy", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("has no ms-chat-proxy reference in the assistant, its chat route, or the widget", () => {
    for (const rel of [
      "./jade.ts",
      "../app/api/jade/chat/route.ts",
      "../components/site/jade-chat.tsx",
    ]) {
      expect(read(rel), rel).not.toContain("ms-chat-proxy");
    }
  });

  it("no longer ships the legacy lead route or its forward to /api/jade/lead", () => {
    expect(existsSync(fileURLToPath(new URL("../app/api/jade/lead/route.ts", import.meta.url)))).toBe(
      false,
    );
    expect(read("../components/site/jade-chat.tsx")).not.toContain("/api/jade/lead");
  });

  it("leaves no false 'passed to the team' language in the widget or the table", () => {
    for (const rel of ["./jade.ts", "../components/site/jade-chat.tsx"]) {
      expect(read(rel), rel).not.toMatch(/to the team|ekibe ilet|i've passed/i);
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
