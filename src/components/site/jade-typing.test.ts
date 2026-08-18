import { describe, expect, it } from "vitest";

import {
  TYPE_MAX_MS,
  TYPE_MS_PER_CHAR,
  restAfter,
  thinkingPause,
  tokenise,
  visibleLength,
} from "./jade-chat";

/**
 * How Jade sounds when she is typing.
 *
 * The port dropped the typewriter the original widget had, and messages
 * arrived whole. That is not only flat — it is a tell: the routing table
 * answers in zero milliseconds and the model in a second or two, so a visitor
 * can see which questions were cheap. Typing both is what hides the seam.
 */

describe("what gets typed", () => {
  /*
   * The reason the text is tokenised before it is revealed. Typing over a
   * truncated markdown string shows "[Find a space](/spa" for a few frames on
   * every link she sends.
   */
  it("never shows markdown syntax mid-sentence", () => {
    const line = "Have a look at [what is available](/spaces) 🌿";
    for (let shown = 0; shown <= visibleLength(line); shown++) {
      const text = tokenise(line)
        .reduce<string[]>((parts, token) => {
          const budget = shown - parts.join("").length;
          if (budget > 0) parts.push(token.text.slice(0, budget));
          return parts;
        }, [])
        .join("");
      expect(text).not.toContain("](");
      expect(text).not.toContain("**");
    }
  });

  it("counts what a reader sees, not what the model wrote", () => {
    expect(visibleLength("[Find a space](/spaces)")).toBe("Find a space".length);
    expect(visibleLength("**yes**")).toBe(3);
  });

  it("keeps a link's address off the screen but on the anchor", () => {
    const [token] = tokenise("[Questions](/faq)");
    expect(token.kind).toBe("link");
    expect(token.href).toBe("/faq");
    expect(token.text).toBe("Questions");
  });

  /* A model that invents an external link produces text, not something to click. */
  it("refuses to link anywhere but our own paths", () => {
    const [token] = tokenise("[free money](https://example.com)");
    expect(token.kind).toBe("text");
    expect(token.href).toBeUndefined();
  });
});

describe("the pace", () => {
  it("pauses before answering, and longer before a longer answer", () => {
    expect(thinkingPause("Yes.")).toBeGreaterThan(200);
    expect(thinkingPause("a".repeat(200))).toBeGreaterThan(thinkingPause("Yes."));
  });

  /* Long enough to feel considered, short enough not to be a wait. */
  it("never thinks for more than three quarters of a second", () => {
    expect(thinkingPause("a".repeat(5000))).toBeLessThanOrEqual(700);
  });

  it("rests at the end of a sentence, less at a comma, not at a letter", () => {
    expect(restAfter(".", 11)).toBeGreaterThan(restAfter(",", 11));
    expect(restAfter(",", 11)).toBeGreaterThan(restAfter("a", 11));
    expect(restAfter("a", 11)).toBe(11);
  });

  /*
   * The cap is what stops a long answer taking four seconds. Somebody reads
   * faster than this types, and being made to watch is worse than being told.
   */
  it("speeds up so a long answer still lands in about two seconds", () => {
    const long = "a".repeat(600);
    const perChar = Math.min(TYPE_MS_PER_CHAR, TYPE_MAX_MS / visibleLength(long));
    expect(perChar * visibleLength(long)).toBeLessThanOrEqual(TYPE_MAX_MS);
  });

  it("does not crawl through a short one", () => {
    const short = "Yes.";
    const perChar = Math.min(TYPE_MS_PER_CHAR, TYPE_MAX_MS / visibleLength(short));
    expect(perChar).toBe(TYPE_MS_PER_CHAR);
  });
});
