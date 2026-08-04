import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The app shipped with none of these, which is the default and is not a
 * neutral one: without a CSP any injected script runs with the session's full
 * authority, and without frame-ancestors the whole app can be loaded invisibly
 * inside someone else's page and clicked through by a user who believes they
 * are somewhere else. What would be framed here is a card authorisation.
 *
 * Every host below is one the app genuinely talks to. The list is short on
 * purpose — it is the allowlist, so anything added is a new thing permitted to
 * execute or to receive data.
 */

/** Stripe's script, its API, and the iframes the Payment Element renders into. */
const STRIPE = ["https://js.stripe.com", "https://api.stripe.com", "https://hooks.stripe.com"];

/** Supabase: REST, auth, storage, and the realtime socket. */
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SOCKET = SUPABASE_ORIGIN.replace(/^https:/, "wss:");

/** OpenStreetMap raster tiles, for the host's own address confirmation map. */
const TILES = "https://tile.openstreetmap.org";

const csp = [
  // Nothing is permitted unless a directive below says so.
  `default-src 'self'`,

  /**
   * 'unsafe-inline' for styles, and only for styles.
   *
   * Colours and positions are set through inline style attributes across
   * dozens of components, and a nonce cannot cover a style attribute. Inline
   * styles cannot execute code; what they can do is deface and overlay, and
   * frame-ancestors closes the overlay route. Scripts get no such exemption.
   */
  `style-src 'self' 'unsafe-inline'`,

  /**
   * No 'unsafe-eval', no 'unsafe-inline'.
   *
   * Next's bundles are external files, and Stripe's script is loaded from its
   * own origin — which is why that origin is named rather than the rule
   * loosened.
   */
  `script-src 'self' ${STRIPE.join(" ")}`,

  // Photos and tiles. `data:` covers inline SVG icons; `blob:` covers the
  // local preview a host sees before their photo has finished uploading.
  `img-src 'self' data: blob: ${SUPABASE_ORIGIN} ${TILES} https://*.stripe.com`,

  `font-src 'self' data:`,

  // Where the browser may send data. The geocoder is deliberately absent:
  // address lookups are proxied through our own server precisely so a host's
  // half-typed home address never leaves their machine for a third party.
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_SOCKET} ${STRIPE.join(" ")}`,

  // Stripe draws the card fields in an iframe of its own.
  `frame-src ${STRIPE.join(" ")}`,

  // Nobody may frame us.
  `frame-ancestors 'none'`,

  `base-uri 'self'`,
  `object-src 'none'`,
  `form-action 'self'`,
  `upgrade-insecure-requests`,
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  // Nothing gained by announcing the framework version to a scanner.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },

          // A year, with subdomains. Vercel serves HTTPS only, so there is no
          // plaintext deployment this could strand.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },

          // For anything that reads only the older header.
          { key: "X-Frame-Options", value: "DENY" },

          // Stops a browser deciding an uploaded file is HTML and rendering it.
          { key: "X-Content-Type-Options", value: "nosniff" },

          // Origin to other sites, full path only to ourselves — a booking URL
          // should not reach a third party as a referrer.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          /**
           * Geolocation is allowed for us alone, because nearby search asks for
           * it. Camera and microphone are off entirely: nothing here needs
           * either, and a permission no feature uses can only be misused.
           */
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=(self), usb=()",
          },

          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
