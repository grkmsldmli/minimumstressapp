import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { crawlPolicyFor, robotsFor, sitemapFor, sitemapPaths } from "./site-map";

describe("crawlPolicyFor", () => {
  it("opens the finished site to crawlers", () => {
    expect(crawlPolicyFor("minimumstress.com")).toBe("index");
    expect(crawlPolicyFor("www.minimumstress.com")).toBe("index");
  });

  /*
   * The staging name serves the same pages the .com will. A search engine that
   * finds it indexes a second copy of every page, and a site competing with
   * itself ranks neither copy — so it stays closed until it stops being a
   * draft.
   */
  it("keeps the staging name out of the index", () => {
    expect(crawlPolicyFor("new.minimumstress.com")).toBe("hidden");
  });

  it("keeps the app out too", () => {
    expect(crawlPolicyFor("minimumstress.app")).toBe("hidden");
    expect(crawlPolicyFor("minimumstressapp.vercel.app")).toBe("hidden");
    expect(crawlPolicyFor("localhost:3000")).toBe("hidden");
  });

  /** A missing Host header is not the public site. */
  it("is closed when there is no host at all", () => {
    expect(crawlPolicyFor(null)).toBe("hidden");
  });
});

describe("robotsFor", () => {
  it("disallows everything on a hidden host, and names no sitemap", () => {
    const text = robotsFor("new.minimumstress.com", "https://new.minimumstress.com");
    expect(text).toContain("Disallow: /");
    expect(text).not.toContain("Allow: /");
    expect(text).not.toContain("Sitemap:");
  });

  it("points the public site at its own sitemap", () => {
    const text = robotsFor("minimumstress.com", "https://minimumstress.com");
    expect(text).toContain("Allow: /");
    expect(text).toContain("Sitemap: https://minimumstress.com/sitemap.xml");
  });
});

describe("sitemapFor", () => {
  it("writes absolute URLs, with no double slash at the root", () => {
    const xml = sitemapFor("https://minimumstress.com");
    expect(xml).toContain("<loc>https://minimumstress.com</loc>");
    expect(xml).toContain("<loc>https://minimumstress.com/tools</loc>");
    expect(xml).not.toContain("minimumstress.com//");
  });
});

/**
 * The sitemap is the one file where we tell a crawler what we are certain
 * about. Naming a page that 404s costs trust in every other line of it — and
 * it is the easiest mistake to make, because a path is added here the moment
 * it is planned rather than the moment it exists. This checks the route file
 * is actually on disk.
 */
describe("every path in the sitemap has a page behind it", () => {
  it.each(sitemapPaths())("%s", (path) => {
    const segment = path === "/" ? "" : path;
    expect(existsSync(`src/app/site${segment}/page.tsx`), `missing src/app/site${segment}/page.tsx`).toBe(
      true,
    );
  });
});
