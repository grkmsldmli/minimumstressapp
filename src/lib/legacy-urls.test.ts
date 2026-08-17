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

  /**
   * The two with nothing behind them, which land on the hub instead.
   *
   * The nervous-system assessment shipped on Shopify with no script at all —
   * its Begin button has never done anything — and no file for the
   * stress-recovery one exists to port.
   */
  const WITHOUT_A_PAGE = ["nervous-system-assessment", "stress-recovery-assessment"];

  /*
   * Nothing was renamed and nothing was merged, so each of the rest lands on
   * its own slug. All that changed is Shopify's /pages prefix.
   */
  it("keeps every tool that has a page at its own name", () => {
    for (const page of SHOPIFY_TOOL_PAGES.filter((p) => !WITHOUT_A_PAGE.includes(p))) {
      expect(destinationFor(`/pages/${page}`), page).toBe(`/tools/${page}`);
    }
  });

  /** And the list here is the list the site actually has. */
  it("matches the tools the site defines", () => {
    expect(TOOLS.map((tool) => tool.slug).sort()).toEqual([...SHOPIFY_TOOL_PAGES].sort());
  });

  it("sends the hub to the hub", () => {
    expect(destinationFor("/pages/wellness-hub")).toBe("/tools");
  });

  /*
   * Two tools have no page to go to: the nervous-system assessment shipped
   * with no script at all, and no file for the stress-recovery one exists.
   * Both land on the hub rather than on a 404.
   */
  it("sends the two that were never built to the hub", () => {
    expect(destinationFor("/pages/nervous-system-assessment")).toBe("/tools");
    expect(destinationFor("/pages/stress-recovery-assessment")).toBe("/tools");
  });
});

describe("articles", () => {
  /*
   * There is no blog on the new site and there is not going to be one, so each
   * article goes to the tool on the same subject. The articles and the tools
   * were written about the same eight things, so most of them have a real
   * match — somebody searching for the burnout piece gets the burnout test.
   */
  it("sends an article to the tool on its subject", () => {
    expect(destinationFor("/blogs/wellness/the-burnout-you-dont-see-coming")).toBe(
      "/tools/burnout-test",
    );
    expect(destinationFor("/blogs/wellness/are-you-really-getting-enough-sleep")).toBe(
      "/tools/sleep-score",
    );
    expect(destinationFor("/blogs/wellness/is-your-body-older-than-you-think")).toBe(
      "/tools/biological-age-calculator",
    );
    expect(destinationFor("/blogs/wellness/bmi-is-broken-heres-what-actually-matters")).toBe(
      "/tools/bmi-calculator",
    );
  });

  it("works from either of the two blogs", () => {
    expect(destinationFor("/blogs/general-info/scientific-methods-to-reduce-stress")).toBe(
      "/tools/burnout-test",
    );
  });

  it("ignores a trailing slash", () => {
    expect(destinationFor("/blogs/wellness/why-you-cant-switch-off/")).toBe("/tools/burnout-test");
  });

  /*
   * The ones with no matching tool are marked gone rather than pointed at the
   * homepage. Redirecting "the bay area wellness guide" to a page about
   * renting rooms tells a search engine the homepage is that guide, and drops
   * a reader who came for one subject onto another.
   */
  it("marks an article with no matching tool as gone", () => {
    expect(destinationFor("/blogs/wellness/bay-area-wellness-guide-2026")).toBeNull();
    expect(isGone("/blogs/wellness/bay-area-wellness-guide-2026")).toBe(true);
  });

  it("sends both blog indexes to the tools", () => {
    expect(destinationFor("/blogs/wellness")).toBe("/tools");
    expect(destinationFor("/blogs/general-info")).toBe("/tools");
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
