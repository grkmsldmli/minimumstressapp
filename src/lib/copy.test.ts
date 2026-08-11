import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The app states facts. It does not thank, reassure, or explain itself.
 *
 * This was corrected three separate times by hand — an account-choice screen
 * that argued the design was deliberate, a terms clause that ended "we can only
 * stand behind what we can see", and a standing card that read "Thank you —
 * people plan their day around these". Each time the substance was fine and the
 * voice was wrong, and each time it came back somewhere else, because nothing
 * was checking.
 *
 * Two reasons it matters beyond taste. Sentiment attached to a rule reads as an
 * opinion about the rule, and an opinion is arguable in a way a fact is not —
 * which is a problem when the sentence is the one a dispute turns on. And a
 * screen that thanks somebody for not cancelling is a screen that will
 * eventually scold them for cancelling.
 *
 * Comments are exempt. Explaining a decision to whoever maintains this is the
 * point of a comment; explaining it to somebody trying to book a room is not.
 */

const SOURCE = join(import.meta.dirname, "..");

/**
 * Phrases that only appear when the app has an attitude about something.
 *
 * Each of these was found in shipped copy, not invented as a hypothetical.
 */
const BANNED = [
  /\bthank you\b/i,
  /\bwe'd rather\b/i,
  /\bwe would rather\b/i,
  /\bwe believe\b/i,
  /\bwe hope\b/i,
  /\bwe can only\b/i,
  /\bthat is not the experience\b/i,
  /\bthe whole point\b/i,
  /\bis not a penalty\b/i,
  /\bplan their day\b/i,
  /\bturned other bookings away\b/i,
  /\bdon't worry\b/i,
  /\bthat's normal\b/i,

  /*
   * The old payment model, which the app promised in six places.
   *
   * The card is charged when a booking is made, not held until the session, so
   * every one of these sentences became untrue in the same commit. They are
   * banned rather than merely fixed because the phrasing is natural enough for
   * anybody who last read the code before it changed to write it again.
   */
  /\bheld rather than charged\b/i,
  /\bnever charged\b/i,
  /\bnot charged yet\b/i,
  /\bwas only ever held\b/i,
  /\bauthoris(ed|ation)\b/i,
  /\bhold is now released\b/i,

  /*
   * The same model, in the words the checkout screen actually used. It said
   * "Hold the hour", listed the total as "Held on your card" and put "Hold
   * $42.00" on the button — three lines above a paragraph beginning "You pay
   * now". The one screen where the contradiction matters most, since it is
   * what somebody reads before typing a card number.
   */
  /\bheld on your card\b/i,
  /\bHold the\b/,
  /\bHold \$\{/,
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    // Tests describe the copy; they are allowed to quote it.
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }

  return found;
}

/** Everything a person could read, with the comments taken out. */
function userFacingText(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the app's voice", () => {
  const files = sourceFiles(SOURCE);

  it("finds source to check", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(BANNED.map((pattern) => [pattern.source, pattern] as const))(
    "never says %s to anybody",
    (_label, pattern) => {
      const offenders = files
        .filter((path) => pattern.test(userFacingText(path)))
        .map((path) => path.slice(SOURCE.length + 1).replace(/\\/g, "/"));

      expect(offenders, offenders.join(", ")).toEqual([]);
    },
  );
});
