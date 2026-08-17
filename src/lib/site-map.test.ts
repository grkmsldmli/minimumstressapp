import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { hostPages } from "./host-pages";
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
 * it is planned rather than the moment it exists.
 *
 * A path can be backed two ways. Most are a route file sitting at that exact
 * address. The host pages are a dynamic segment instead, so for those the
 * check is that the route exists *and* that the slug is one the route actually
 * generates — a URL in the sitemap that `generateStaticParams` does not
 * produce is a 404 with extra steps.
 */
function backedByAFile(path: string): boolean {
  const segment = path === "/" ? "" : path;
  return existsSync(`src/app/site${segment}/page.tsx`);
}

function backedByADynamicRoute(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return false;

  const parent = parts.slice(0, -1).join("/");
  const dir = `src/app/site/${parent}`;
  if (!existsSync(dir)) return false;

  // Exactly one dynamic child, which is all any route here has. A directory
  // with two would be ambiguous to Next as well as to this.
  const dynamic = readdirSync(dir).filter((name) => name.startsWith("[") && name.endsWith("]"));
  return dynamic.some((name) => existsSync(`${dir}/${name}/page.tsx`));
}

describe("every path in the sitemap has a page behind it", () => {
  it.each(sitemapPaths())("%s", (path) => {
    expect(
      backedByAFile(path) || backedByADynamicRoute(path),
      `nothing serves ${path}`,
    ).toBe(true);
  });
});

/**
 * And the ten dynamic ones are the ten the route generates.
 *
 * The file existing proves a route answers that shape of URL. It does not
 * prove this particular slug is one of them — and a sitemap advertising
 * /rent-out-your/therapy-office, which the route correctly 404s, is worse than
 * not listing it at all.
 */
describe("the generated host pages", () => {
  const listed = sitemapPaths()
    .filter((path) => path.startsWith("/rent-out-your/"))
    .map((path) => path.replace("/rent-out-your/", ""));

  it("lists exactly what the route builds", () => {
    expect(listed.sort()).toEqual(hostPages().map((page) => page.type.slug).sort());
  });

  it("lists their parent too, so the path is not headless", () => {
    expect(sitemapPaths()).toContain("/rent-out-your");
  });

  /*
   * The fixed list may name /spaces — that page is written, and it says
   * plainly that nothing is listed yet when nothing is. What it may never name
   * is a town: /spaces/ca/san-mateo has content only if somebody has listed a
   * room there, so it belongs in the generated half, behind the threshold. A
   * town appearing in this list arrived without the rule that gates it.
   */
  it("names the directory itself but never a town", () => {
    expect(sitemapPaths()).toContain("/spaces");
    expect(sitemapPaths().filter((path) => path.startsWith("/spaces/"))).toEqual([]);
  });
});
