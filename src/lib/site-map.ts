import { TOOLS } from "./tools";

/**
 * What a crawler is told, which is not the same on all three hostnames.
 *
 * One deployment answers to the app, the content site, and the staging name
 * the site is being built on — and Next's static `robots.ts` and `sitemap.ts`
 * cannot tell them apart, because they are generated once at build time with
 * no request to read. So this is computed per request instead.
 *
 * The staging name is the reason it matters. new.minimumstress.com serves the
 * same pages as minimumstress.com will, and a search engine that finds it
 * indexes a second copy of every page — which is how a site ends up competing
 * with itself and neither copy ranks. It is closed to crawlers until it stops
 * being staging.
 */

/** The hostnames the finished content site will answer to. */
const PUBLIC_SITE_HOSTS = new Set(["minimumstress.com", "www.minimumstress.com"]);

export type CrawlPolicy = "index" | "hidden";

export function crawlPolicyFor(host: string | null): CrawlPolicy {
  const name = (host ?? "").split(":")[0].toLowerCase();
  return PUBLIC_SITE_HOSTS.has(name) ? "index" : "hidden";
}

/**
 * The paths worth listing, which is the live ones and nothing else.
 *
 * A sitemap naming a page that 404s is worse than a short sitemap: it is the
 * one file where we tell a crawler what we are sure about, and being wrong in
 * it costs trust in the rest.
 */
export function sitemapPaths(): string[] {
  return ["/", "/tools", "/about", "/for-hosts", ...TOOLS.filter((t) => t.live).map((t) => `/tools/${t.slug}`)];
}

export function robotsFor(host: string | null, origin: string): string {
  if (crawlPolicyFor(host) === "hidden") {
    // Everything, including the app: its pages are behind a sign-in and there
    // is nothing on them a crawler can reach or would want.
    return ["User-agent: *", "Disallow: /"].join("\n");
  }

  return [
    "User-agent: *",
    "Allow: /",
    // Neither belongs to the content site, and both are dead ends for a
    // crawler — one needs a session, the other is a redirect table.
    "Disallow: /api/",
    "Disallow: /auth/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
  ].join("\n");
}

export function sitemapFor(origin: string): string {
  const urls = sitemapPaths()
    .map((path) => `  <url><loc>${origin}${path === "/" ? "" : path}</loc></url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
