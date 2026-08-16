import { describe, expect, it } from "vitest";

import { APP_URL } from "./company";
import { destinationFor, isGone } from "./legacy-urls";
import { TOOLS } from "./tools";

/**
 * The addresses that exist on Shopify today, and where each one lands.
 *
 * Whatever ranking these have took a year to earn and is gone in a week if
 * they answer 404 on the day the apex moves. There is no way to ask for the
 * position back, so this file is the thing standing between a year of writing
 * and a clean slate nobody wanted.
 */

/**
 * The tool pages in the Shopify sitemap, read off it rather than counted.
 *
 * Written out because a count cannot catch the failure that matters. If a page
 * is dropped from the tool list by accident, `replaces.length` simply gets
 * smaller and a test asserting a number has to be edited to make it pass —
 * which is the moment the redirect is lost. A name here fails loudly instead.
 */
const SHOPIFY_TOOL_PAGES = [
  "burnout-test",
  "nervous-system-assessment",
  "cortisol-assessment",
  "stress-recovery-assessment",
  "sleep-score",
  "gut-health-score",
  "inflammation-score",
  "biological-age-calculator",
  "bmi-calculator",
  "body-fat-calculator",
  "tdee-calculator",
];

describe("tool pages", () => {
  it("sends every one that exists on Shopify somewhere", () => {
    for (const page of SHOPIFY_TOOL_PAGES) {
      expect(destinationFor(`/pages/${page}`), page).not.toBeNull();
    }
  });

  /** And nothing claims to replace a page that was never there. */
  it("does not carry redirects for pages that never existed", () => {
    const claimed = TOOLS.flatMap((tool) => tool.replaces);
    for (const page of claimed) {
      expect(SHOPIFY_TOOL_PAGES, page).toContain(page);
    }
  });

  /** The four stress tests were merged; all four keep working. */
  it("folds the merged assessments onto the one that replaced them", () => {
    expect(destinationFor("/pages/burnout-test")).toBe("/tools/stress-load");
    expect(destinationFor("/pages/cortisol-assessment")).toBe("/tools/stress-load");
    expect(destinationFor("/pages/nervous-system-assessment")).toBe("/tools/stress-load");
    expect(destinationFor("/pages/stress-recovery-assessment")).toBe("/tools/stress-load");
  });

  it("keeps the renamed ones reachable under their old address", () => {
    expect(destinationFor("/pages/biological-age-calculator")).toBe("/tools/lifestyle-age");
    expect(destinationFor("/pages/bmi-calculator")).toBe("/tools/bmi");
    expect(destinationFor("/pages/tdee-calculator")).toBe("/tools/energy-needs");
  });

  it("sends the hub to the hub", () => {
    expect(destinationFor("/pages/wellness-hub")).toBe("/tools");
  });
});

describe("articles", () => {
  /*
   * Shopify wrote these as /blogs/<blog>/<slug> across two blogs. The slug is
   * the part worth keeping, so this is a pattern rather than a list of fifteen
   * that somebody has to remember to extend.
   */
  it("keeps the slug and drops the blog it happened to sit in", () => {
    expect(destinationFor("/blogs/wellness/why-you-cant-switch-off")).toBe(
      "/articles/why-you-cant-switch-off",
    );
    expect(destinationFor("/blogs/general-info/scientific-methods-to-reduce-stress")).toBe(
      "/articles/scientific-methods-to-reduce-stress",
    );
  });

  it("sends both blog indexes to the one list", () => {
    expect(destinationFor("/blogs/wellness")).toBe("/articles");
    expect(destinationFor("/blogs/general-info")).toBe("/articles");
  });

  it("ignores a trailing slash", () => {
    expect(destinationFor("/blogs/wellness/the-burnout-you-dont-see-coming/")).toBe(
      "/articles/the-burnout-you-dont-see-coming",
    );
  });
});

describe("policy and company pages", () => {
  /*
   * These leave the origin on purpose. The terms are agreed to in the app and
   * the accepted version is recorded there; a second copy on the content site
   * is a second contract that can drift from the one people signed.
   */
  it("sends the legal ones across to the app, where they are agreed to", () => {
    expect(destinationFor("/pages/privacy-policy")).toBe(`${APP_URL}/privacy`);
    expect(destinationFor("/pages/terms-of-service")).toBe(`${APP_URL}/terms`);
    expect(destinationFor("/pages/cookie-policy")).toBe(`${APP_URL}/privacy`);
    expect(destinationFor("/pages/wellness-disclaimer")).toBe(`${APP_URL}/terms`);
  });

  it("sends both application forms to the one page that replaces them", () => {
    expect(destinationFor("/pages/application-form")).toBe("/for-hosts");
    expect(destinationFor("/pages/consultant-application-form")).toBe("/for-hosts");
    expect(destinationFor("/pages/partner-with-us")).toBe("/for-hosts");
  });
});

describe("the shop", () => {
  /*
   * Gone rather than redirected. Pointing a discontinued product at the
   * homepage tells a search engine the homepage is the product, and drops
   * somebody hunting for a specific item onto a page about renting rooms.
   */
  it("marks products and collections as gone", () => {
    expect(isGone("/collections/all-session")).toBe(true);
    expect(isGone("/products/lavender-oil")).toBe(true);
    expect(isGone("/cart")).toBe(true);
  });

  it("does not redirect them anywhere", () => {
    expect(destinationFor("/collections/all-session")).toBeNull();
    expect(destinationFor("/products/lavender-oil")).toBeNull();
  });

  it("leaves our own pages alone", () => {
    expect(isGone("/tools")).toBe(false);
    expect(isGone("/articles")).toBe(false);
    expect(isGone("/")).toBe(false);
  });
});

describe("everything else", () => {
  it("has no destination, and is left to 404 honestly", () => {
    expect(destinationFor("/")).toBeNull();
    expect(destinationFor("/tools")).toBeNull();
    expect(destinationFor("/pages/a-page-that-never-existed")).toBeNull();
  });
});
