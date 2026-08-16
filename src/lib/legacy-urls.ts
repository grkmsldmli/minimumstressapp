import { TOOLS } from "./tools";

/**
 * Where every Shopify URL goes once the apex moves here.
 *
 * The store has around forty-five addresses that resolve today: fifteen
 * articles, twelve tool pages, the policy pages, and a catalogue we are
 * closing. Whatever ranking those have took a year to earn and is lost in a
 * week if they answer 404 — search engines drop a page long before anyone
 * notices, and there is no way to ask for the position back.
 *
 * So the rule is: every address that works today keeps working. A permanent
 * redirect passes the ranking to the new page; a 404 throws it away.
 *
 * The exception is the shop. Products and collections are not moving anywhere
 * — the store is closing, and pointing a discontinued product at the homepage
 * is a worse answer than saying it is gone. See `GONE` below.
 */

/** Shopify's own paths, which are not ours. */
const SHOPIFY_PREFIXES = ["/collections/", "/products/", "/cart", "/checkout", "/account"];

/**
 * Product and collection URLs, which are deliberately not redirected.
 *
 * Google treats 410 Gone as "remove this and stop asking", and 404 as "maybe
 * later". Both drop the page; 410 does it without wasting crawl budget coming
 * back for months. Redirecting them to the homepage instead would be the
 * common move and the wrong one: it tells a search engine the homepage is the
 * product, and it drops somebody hunting for a specific item onto a page about
 * renting rooms.
 */
export function isGone(pathname: string): boolean {
  return SHOPIFY_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix),
  );
}

/**
 * The twelve tool pages, folded onto the six that replaced them.
 *
 * Generated from the tool list rather than typed out again, so a tool that is
 * renamed or merged later cannot leave a redirect pointing at nothing.
 */
function toolRedirects(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tool of TOOLS) {
    for (const page of tool.replaces) {
      map[`/pages/${page}`] = `/tools/${tool.slug}`;
    }
  }
  map["/pages/wellness-hub"] = "/tools";
  return map;
}

/**
 * The rest, by hand, because each one is a judgement.
 *
 * Returns and refunds describe a shop that will not exist, so they go to the
 * page that says what the company does now rather than to a policy about
 * posting something back. The terms and the privacy notice live in the app,
 * because that is where they are agreed to and where the accepted version is
 * recorded.
 */
const PAGE_REDIRECTS: Record<string, string> = {
  "/pages/about-us": "/about",
  "/pages/contact-us": "/about",
  "/pages/faq": "/about",
  "/pages/community-speaks": "/about",

  "/pages/consultant-application-form": "/for-hosts",
  "/pages/application-form": "/for-hosts",
  "/pages/partner-with-us": "/for-hosts",

  "/pages/privacy-policy": "/privacy",
  "/pages/cookie-policy": "/privacy",
  "/pages/data-sharing-opt-out": "/privacy",
  "/pages/terms-of-service": "/terms",
  "/pages/wellness-disclaimer": "/terms",
  "/pages/consent-form": "/terms",

  // A shop's returns policy, on a site that will not be selling anything.
  "/pages/returns-exchanges": "/about",
  "/pages/refund-cancellation-policy": "/about",
  "/pages/wellness-brief": "/articles",

  // Shopify's blog paths. Both indexes land on the one list that replaces them.
  "/blogs/wellness": "/articles",
  "/blogs/general-info": "/articles",
};

/**
 * The destination for an old address, or null if there is not one.
 *
 * Article URLs are handled by pattern rather than listed: Shopify wrote them
 * as `/blogs/<blog>/<slug>` and the slug is the part worth keeping, so
 * `/blogs/wellness/why-you-cant-switch-off` becomes
 * `/articles/why-you-cant-switch-off` without anybody maintaining a list of
 * fifteen.
 */
export function destinationFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";

  const article = path.match(/^\/blogs\/[^/]+\/(.+)$/);
  if (article) return `/articles/${article[1]}`;

  return toolRedirects()[path] ?? PAGE_REDIRECTS[path] ?? null;
}
