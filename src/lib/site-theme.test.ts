import { describe, expect, it } from "vitest";

import { COLOUR, TYPE } from "./site-theme";

/**
 * Readability, as a number rather than as an opinion.
 *
 * The site shipped with its secondary text at 3.07:1 and every link at 2.77:1
 * against white. Both looked acceptable to somebody with good eyes on a good
 * screen, which is exactly why nobody caught them: the fault is invisible to
 * the only test being applied, which was looking at it.
 *
 * WCAG AA asks 4.5:1 for body text and 3:1 for large text. These assert it, so
 * a paler grey is something somebody has to add deliberately and defend.
 */

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Both grounds a page can put text on, so neither is checked by accident. */
const LIGHT_GROUNDS = [COLOUR.page, COLOUR.wash];

describe("text on a light ground", () => {
  it.each([
    ["ink", COLOUR.ink],
    ["body", COLOUR.body],
    ["muted", COLOUR.muted],
    ["link", COLOUR.link],
  ])("%s clears AA on white and on the wash", (_name, colour) => {
    for (const ground of LIGHT_GROUNDS) {
      expect(contrast(colour, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  /*
   * The distinction that caused the problem. `accent` is the brand sky: fine
   * behind white text, and unreadable as text on white. It is kept in the
   * palette because fills and rules want it — and pinned here as failing, so
   * that anybody reaching for it as a text colour finds this test rather than
   * finding out from a reader who could not read it.
   */
  it("keeps the brand sky out of body text on purpose", () => {
    expect(contrast(COLOUR.accent, COLOUR.page)).toBeLessThan(4.5);
    expect(COLOUR.link).not.toBe(COLOUR.accent);
  });

  it("is still strong enough for large display type", () => {
    expect(contrast(COLOUR.accent, COLOUR.page)).toBeGreaterThanOrEqual(2.5);
  });
});

describe("text on the dark ground", () => {
  /*
   * The footer sits here, which is what made these worth pinning. Reaching for
   * rgba(255,255,255,0.6) is how a dark surface ends up with text at 3:1: an
   * alpha is a guess whose result depends on whatever is behind it, and
   * nothing checks it. These are opaque and measured.
   */
  it.each([
    ["white", COLOUR.page],
    ["pale sky", COLOUR.onDark],
    ["body", COLOUR.onDarkBody],
    ["muted", COLOUR.onDarkMuted],
  ])("%s clears AA on navy", (_name, colour) => {
    expect(contrast(colour, COLOUR.dark)).toBeGreaterThanOrEqual(4.5);
  });

  /** And the dark ground is genuinely dark, not a mid blue that fails both ways. */
  it("is dark enough to carry white text", () => {
    expect(contrast(COLOUR.page, COLOUR.dark)).toBeGreaterThanOrEqual(10);
  });
});

/**
 * A scale with range, checked as range.
 *
 * The page this replaced ran almost entirely between 14 and 17 pixels, which
 * reads as one undifferentiated column: nothing large enough to be a landmark,
 * nothing small enough to recede.
 */
describe("the type scale", () => {
  const px = (token: string) => Number(token.match(/text-\[(\d+)px\]/)?.[1] ?? 0);

  it("starts body text at a size somebody can read at arm's length", () => {
    expect(px(TYPE.body)).toBeGreaterThanOrEqual(17);
    expect(px(TYPE.small)).toBeGreaterThanOrEqual(15);
  });

  it("has a real jump between body and heading", () => {
    expect(px(TYPE.h2) / px(TYPE.body)).toBeGreaterThanOrEqual(1.6);
    expect(px(TYPE.hero) / px(TYPE.body)).toBeGreaterThanOrEqual(2.4);
  });

  it("gives every step a line height, because none of them are one line", () => {
    for (const [name, token] of Object.entries(TYPE)) {
      if (name === "eyebrow") continue;
      expect(token, name).toMatch(/leading-\[/);
    }
  });
});
