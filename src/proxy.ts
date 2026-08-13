import { NextResponse, type NextRequest } from "next/server";

import { TILE_ORIGIN } from "@/lib/map-tiles";

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

  const csp = [
    `default-src 'self'`,

    // Inline styles stay permitted: colours and positions are set through
    // style attributes across dozens of components, and a nonce cannot cover
    // an attribute. Styles cannot execute — frame-ancestors closes the
    // overlay route that is the real risk.
    `style-src 'self' 'unsafe-inline'`,

    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV_EVAL} ${STRIPE}`,

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

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the image optimiser. Those are
     * served straight from the CDN and carry no scripts, so running this on
     * them costs an invocation and buys nothing.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
