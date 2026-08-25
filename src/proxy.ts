import { NextResponse, type NextRequest } from "next/server";

import { TILE_ORIGIN } from "@/lib/map-tiles";
import { destinationFor, isGone } from "@/lib/legacy-urls";
import { isSharedPath, isSiteHost } from "@/lib/site-host";

/**
 * The content security policy, built per request so it can carry a nonce.
 *
 * It lived in next.config.ts as a static header, and that was a bug that took
 * the whole app down in production: Next bootstraps hydration with inline
 * scripts, a static policy cannot name them, and `script-src` without
 * 'unsafe-inline' blocked every one. Every file still returned 200, so nothing
 * looked wrong — React simply never mounted and every button on the site was
 * inert.
 *
 * A nonce is the fix rather than 'unsafe-inline'. Next reads it back off the
 * request's own CSP header and stamps it on the scripts it generates, so
 * exactly those inline scripts run and an injected one still does not.
 *
 * 'strict-dynamic' then lets a trusted script load what it needs — Stripe's
 * SDK loads itself from js.stripe.com — without the policy having to list
 * every URL. Browsers that honour it ignore the host allowlist entirely; the
 * hosts stay below for the ones that do not.
 */

const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SOCKET = SUPABASE_ORIGIN.replace(/^https:/, "wss:");
const STRIPE = "https://js.stripe.com https://api.stripe.com https://hooks.stripe.com";
/*
 * Read from the same module the maps read, rather than written down twice. A
 * policy naming one tile host while the pictures come from another blocks
 * every tile on both maps at once, and a blocked image fails silently.
 */
const TILES = TILE_ORIGIN;

/**
 * The one thing development needs and production must never have.
 *
 * React's development build calls eval() to rebuild a callstack that crossed
 * the server/client boundary, and Turbopack compiles hot-reloaded modules the
 * same way. Under the shipped policy both are refused, so `next dev` opened on
 * a console error and stack traces lost the source positions that make them
 * worth reading — the tooling was broken, on the machine where the tooling is
 * the whole point.
 *
 * Off everywhere else, which is the half that matters: a string reaching
 * eval() has the same reach as an injected script tag, and that is the attack
 * the nonce exists to stop. NODE_ENV is set by the framework rather than by
 * us, so this cannot be turned on by an environment file — and the test below
 * pins it shut for every value but "development".
 */
const DEV_EVAL = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const forSite = isSiteHost(request.headers.get("host"));

  /**
   * Two policies, because the two sites are rendered differently.
   *
   * A nonce has to be fresh on every request, which means the HTML carrying it
   * has to be built on every request. The app is, so it gets the strict policy
   * below and 'strict-dynamic' with it.
   *
   * The content site is prerendered at build time and served from the CDN —
   * which is right for a marketing site, and completely incompatible with a
   * nonce. Its script tags were built hours earlier and carry no nonce, while
   * the header demanded one; 'strict-dynamic' then disables the 'self'
   * allowlist that would otherwise have saved it. So every script on the
   * content site was blocked. Not the carousel, not one tool — all of it: no
   * assessment ran, no button did anything, and the pages looked completely
   * normal while being completely inert.
   *
   * So the content site drops the nonce and allows its own origin. That is a
   * weaker policy and an appropriate one: it is static HTML with no sign-in,
   * no payment, and nothing user-submitted rendered back out, so there is no
   * injection route for the nonce to close. The strict policy stays where the
   * card details are.
   */
  const scriptSrc = forSite
    ? `script-src 'self' 'unsafe-inline'${DEV_EVAL}`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV_EVAL} ${STRIPE}`;

  const csp = [
    `default-src 'self'`,

    // Inline styles stay permitted: colours and positions are set through
    // style attributes across dozens of components, and a nonce cannot cover
    // an attribute. Styles cannot execute — frame-ancestors closes the
    // overlay route that is the real risk.
    `style-src 'self' 'unsafe-inline'`,

    scriptSrc,

    // `data:` covers inline SVG icons; `blob:` covers the local preview a host
    // sees before their photo has finished uploading.
    `img-src 'self' data: blob: ${SUPABASE_ORIGIN} ${TILES} https://*.stripe.com`,

    /*
     * Video, which had no directive and so fell through to default-src 'self'.
     *
     * A host can upload a room tour, and the browser would have refused to
     * play it back from the bucket it was just stored in — silently, since a
     * blocked media element looks the same as one that has not loaded yet.
     * Same origins as img-src, for the same files.
     */
    `media-src 'self' data: blob: ${SUPABASE_ORIGIN}`,

    `font-src 'self' data:`,

    // The geocoder is deliberately absent: address lookups are proxied through
    // our own server precisely so a host's half-typed home address never
    // leaves their machine for a third party.
    `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_SOCKET} ${STRIPE}`,

    `frame-src ${STRIPE}`,

    // Nobody may frame us. What would be framed here is a card authorisation.
    `frame-ancestors 'none'`,

    `base-uri 'self'`,
    `object-src 'none'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  // Set on the *request* as well, because that is where Next looks for the
  // nonce to stamp on its own scripts.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  /*
   * Two sites, one deployment, told apart by the hostname.
   *
   * minimumstress.com is rewritten into `/site`, so its pages are written at
   * the path a reader sees — `/articles`, not `/site/articles` — and no link
   * on either side has to know which host it is being rendered for. A rewrite
   * rather than a redirect: the address bar keeps the real URL.
   *
   * The app keeps the root of minimumstress.app, which is why nothing about
   * it moves and no sign-in or OAuth callback changes.
   */
  const { pathname } = request.nextUrl;
  const onSite = forSite;

  /*
   * The addresses Shopify is answering today.
   *
   * Around forty-five of them resolve, and whatever ranking they carry took a
   * year of writing to earn and is gone in a week if they start returning 404
   * — a search engine drops a page long before anybody notices, and the
   * position cannot be asked for back. A permanent redirect hands the ranking
   * to the page that replaced it.
   *
   * Only on the content host. `/pages/faq` on the app is not a Shopify page;
   * it is a path that does not exist, and should say so.
   */
  if (onSite) {
    const destination = destinationFor(pathname);
    if (destination) {
      const moved = NextResponse.redirect(new URL(destination, request.url), 308);
      moved.headers.set("Content-Security-Policy", csp);
      return moved;
    }

    /*
     * The shop, which is not moving anywhere.
     *
     * 410 tells a search engine to drop the page and stop coming back; 404
     * only says "maybe later" and wastes months of crawls. Redirecting a
     * discontinued product to the homepage would be worse than either — it
     * claims the homepage is the product, and drops somebody hunting for an
     * item onto a page about renting rooms.
     */
    if (isGone(pathname)) {
      const gone = new NextResponse("This page has been removed.", {
        status: 410,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
      gone.headers.set("Content-Security-Policy", csp);
      return gone;
    }
  }

  const response =
    onSite && !isSharedPath(pathname)
      ? // The search string is carried across the rewrite, not dropped: a `/site`
        // page that reads it server-side — the directory filtering on `?type=`,
        // for one — would otherwise be handed an empty query and silently ignore
        // the filter, since the rewrite target is an absolute path.
        NextResponse.rewrite(new URL(`/site${pathname}${request.nextUrl.search}`, request.url), {
          request: { headers },
        })
      : NextResponse.next({ request: { headers } });

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the image optimiser. Those are
     * served straight from the CDN and carry no scripts, so running this on
     * them costs an invocation and buys nothing.
     *
     * Prefetches are NOT excluded, and that exclusion is what this comment is
     * really about. The stock matcher skips middleware when the router is
     * prefetching, on the reasoning that a prefetch is only a warm-up and not
     * worth an invocation. That is true when middleware only sets headers. It
     * is false here, because this middleware decides *which page a URL is*:
     * /about is the content site's page on minimumstress.com and the app's
     * page on minimumstress.app, and the rewrite is the only thing that knows.
     *
     * Skipped on the prefetch, the router fetched /about with no rewrite, got
     * the app's page, and cached it. Clicking About then rendered the app's
     * About inside the content site — while a hard reload, which carries no
     * prefetch header and so did run this, showed the right one. A bug that
     * appears only when you arrive by clicking and vanishes the moment you
     * reload is one nobody can report and nobody can find.
     *
     * So it runs on every request that can turn into a page, including the
     * ones the router makes on its own.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
