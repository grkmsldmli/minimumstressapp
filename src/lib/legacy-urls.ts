import { APP_URL } from "./company";

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

import { TOOLS } from "./tools";

/** Their slugs, which the new pages keep. */
const TOOL_SLUGS = new Set(TOOLS.map((tool) => tool.slug));

/**
 * The two tools that have no page to send anybody to.
 *
 * The nervous-system assessment shipped on Shopify with no script at all, so
 * its Begin button has never done anything, and no source for the
 * stress-recovery one exists to port. Both addresses are in the sitemap and
 * will be asked for, so both go to the hub.
 */
const WITHOUT_A_PAGE = new Set(["nervous-system-assessment", "stress-recovery-assessment"]);

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
  // An article with no tool on the same subject. The blog is not moving here,
  // and 410 says so once rather than making a crawler ask for months.
  if (/^\/blogs\/[^/]+\/.+$/.test(pathname)) return true;

  return SHOPIFY_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix),
  );
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

  /*
   * Across to the app, which is where these actually live.
   *
   * They are agreed to there, and the version somebody accepted is recorded
   * against their account there. A second copy on this side would be a second
   * contract that can drift from the one people signed — so the redirect
   * leaves the origin rather than pretending the page is here.
   */
  "/pages/privacy-policy": `${APP_URL}/privacy`,
  "/pages/cookie-policy": `${APP_URL}/privacy`,
  "/pages/data-sharing-opt-out": `${APP_URL}/privacy`,
  "/pages/terms-of-service": `${APP_URL}/terms`,
  "/pages/wellness-disclaimer": `${APP_URL}/terms`,
  "/pages/consent-form": `${APP_URL}/terms`,

  // A shop's returns policy, on a site that will not be selling anything.
  "/pages/returns-exchanges": "/about",
  "/pages/refund-cancellation-policy": "/about",
  "/pages/wellness-brief": "/assessments",

  // Shopify's blog paths. Both indexes land on the one list that replaces them.
  "/pages/wellness-hub": "/assessments",

  "/blogs/wellness": "/assessments",
  "/blogs/general-info": "/assessments",
};

/**
 * Each article, sent to the tool that covers the same ground.
 *
 * There is no blog on the new site and there is not going to be one, so these
 * fifteen addresses have to land somewhere. The homepage would be the usual
 * answer and the wrong one — it tells a search engine the homepage is what
 * "the burnout you don't see coming" is about, and it drops a reader who came
 * for one subject onto a page about renting rooms.
 *
 * Most of them have a direct match, because the articles and the tools were
 * written about the same eight subjects. Somebody searching for the burnout
 * piece gets the burnout test: not what they clicked, but the same topic and
 * something they can actually use.
 *
 * The five with no match are deliberately absent — they fall through to 410
 * below, which is the honest answer for writing that is not coming back.
 */
const ARTICLE_TO_TOOL: Record<string, string> = {
  "the-burnout-you-dont-see-coming": "burnout-test",
  "why-you-cant-switch-off": "burnout-test",
  "scientific-methods-to-reduce-stress": "burnout-test",
  "5-stress-management-techniques-you-can-apply-instantly-in-daily-life": "burnout-test",
  "the-silent-damage-of-chronic-cortisol": "cortisol-assessment",
  "are-you-really-getting-enough-sleep": "sleep-score",
  "your-gut-is-talking-are-you-listening": "gut-health-score",
  "the-inflammation-nobody-talks-about": "inflammation-score",
  "is-your-body-older-than-you-think": "biological-age-calculator",
  "bmi-is-broken-heres-what-actually-matters": "bmi-calculator",
  "why-most-calorie-advice-is-wrong": "tdee-calculator",
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

  /*
   * /tools became /assessments, and the old address still has to work.
   *
   * The word was the problem: "tools" is what a content farm calls a quiz, and
   * the page is a set of scored instruments. But the ranking on these lives on
   * the old URL — the Shopify migration above exists precisely because a URL
   * that starts returning 404 loses a year of writing in a week, and doing
   * that to ourselves a month later would be the same mistake with less
   * excuse. So the rename is a 308 rather than a deletion, and the map above
   * was repointed at /assessments so a Shopify address arrives in one hop
   * instead of two.
   *
   * First, before any other rule. /pages/... and /blogs/... cannot match this
   * shape, but a later reader adding a rule above it would silently break
   * every link anybody has ever shared.
   */
  if (path === "/tools") return "/assessments";
  const movedTool = path.match(/^\/tools\/(.+)$/);
  if (movedTool) return `/assessments/${movedTool[1]}`;

  /*
   * An article goes to the tool on the same subject, or nowhere.
   *
   * Nowhere means 410 rather than a redirect to the homepage: writing that is
   * not coming back should be marked gone, not quietly pointed at a page about
   * something else.
   */
  const article = path.match(/^\/blogs\/[^/]+\/(.+)$/);
  if (article) {
    const tool = ARTICLE_TO_TOOL[article[1]];
    return tool ? `/assessments/${tool}` : null;
  }

  /*
   * The tools keep their own slugs, so /pages/burnout-test is simply
   * /burnout-test here — nothing was renamed and nothing was merged, and the
   * only thing that changed is Shopify's /pages prefix.
   *
   * Except the two with nothing behind them. The nervous-system assessment
   * shipped on Shopify with no script at all — its Begin button has never done
   * anything — and no file for the stress-recovery one exists to port. They
   * land on the hub, where somebody gets the nine that work instead of a 404.
   */
  const toolPage = path.match(/^\/pages\/(.+)$/);
  if (toolPage && WITHOUT_A_PAGE.has(toolPage[1])) return "/assessments";
  if (toolPage && TOOL_SLUGS.has(toolPage[1])) return `/assessments/${toolPage[1]}`;

  return PAGE_REDIRECTS[path] ?? null;
}
