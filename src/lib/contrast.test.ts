import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AA_LARGE, AA_NORMAL, SURFACES, contrast, luminance } from "./contrast";

/**
 * The palette, read out of the stylesheet that ships.
 *
 * Not a copy of the values — a copy would keep passing after somebody changed
 * the real ones, which is the failure mode this whole file exists to prevent.
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function token(name: string): string {
  const found = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!found) throw new Error(`--color-${name} is not in globals.css`);
  return found[1];
}

describe("contrast", () => {
  it("puts black on white at the top of the scale", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("gives a colour against itself the bottom of the scale", () => {
    expect(contrast("#3b9be8", "#3b9be8")).toBeCloseTo(1, 5);
  });

  it("does not care which colour is named first", () => {
    expect(contrast("#16304e", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#16304e"), 10);
  });

  it("weights green above red above blue, as luminance does", () => {
    expect(luminance("#00ff00")).toBeGreaterThan(luminance("#ff0000"));
    expect(luminance("#ff0000")).toBeGreaterThan(luminance("#0000ff"));
  });
});

/**
 * Every ink level used for words, on every surface a card is drawn in.
 *
 * Measuring against white alone is how ink-faint passed review and then failed
 * in the app: on a tinted card it lost a third of a point and dropped under
 * the line. Text does not know what is behind it.
 */
describe("the ink scale", () => {
  const forProse = ["ink", "ink-muted", "ink-soft", "ink-faint"];

  for (const name of forProse) {
    for (const [surface, background] of Object.entries(SURFACES)) {
      it(`sets ${name} readably on ${surface}`, () => {
        expect(contrast(token(name), background)).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }

  it("keeps each step visibly lighter than the one before", () => {
    const steps = forProse.map((name) => contrast(token(name), SURFACES.white));

    for (let i = 1; i < steps.length; i++) {
      expect(steps[i], forProse[i]).toBeLessThan(steps[i - 1]);
    }
  });

  /**
   * Ghost is exempt because it is not prose — it is placeholder text and
   * disabled controls, which WCAG excludes. It is named here so that the
   * exemption is a decision on the record rather than an oversight, and so
   * anybody reaching for it in a sentence has to come past this.
   */
  it("keeps ghost out of the prose set", () => {
    expect(forProse).not.toContain("ink-ghost");
    expect(contrast(token("ink-ghost"), SURFACES.white)).toBeLessThan(AA_NORMAL);
  });
});

/**
 * Three blues, each with one job.
 *
 * They were one blue, and it failed at two of the three: unreadable as a label
 * on white, and unreadable under the white lettering of the primary button.
 */
describe("the blues", () => {
  it("carries white lettering on the button somebody is meant to press", () => {
    expect(contrast("#ffffff", token("sky-cta"))).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  for (const [surface, background] of Object.entries(SURFACES)) {
    it(`can be read as words on ${surface}`, () => {
      expect(contrast(token("sky-text"), background)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }

  /**
   * The brand blue keeps failing both tests, and that is correct — it fills
   * and draws, and nothing is set on top of it. The assertion is here so that
   * a later attempt to "fix" it by darkening the brand fails loudly instead.
   */
  it("leaves the brand blue alone", () => {
    expect(token("sky")).toBe("#3b9be8");
    expect(contrast("#ffffff", token("sky"))).toBeLessThan(AA_NORMAL);
  });

  it("keeps sky-soft for dark backgrounds only", () => {
    expect(contrast(token("sky-soft"), "#16304e")).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("the semantic accents", () => {
  it.each([
    ["positive", "positive-bg"],
    ["warn", "warn-bg"],
    ["danger", "danger-bg"],
  ])("sets %s readably on its own background", (ink, background) => {
    expect(contrast(token(ink), token(background))).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(["positive", "warn", "danger"])("sets %s readably on white", (ink) => {
    expect(contrast(token(ink), SURFACES.white)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

/**
 * White on navy, which is most of the app's headline type.
 *
 * Large-text threshold, because that is what these are — a headline at 22px
 * and up, never body copy.
 */
describe("the dark screens", () => {
  it.each(["navy", "navy-deep", "navy-lift"])("carries white type on %s", (name) => {
    expect(contrast("#ffffff", token(name))).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
