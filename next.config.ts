import type { NextConfig } from "next";

/**
 * The headers that are the same on every response.
 *
 * The content security policy is deliberately NOT here. It needs a per-request
 * nonce so Next's own inline hydration scripts can run, and a static header
 * cannot carry one — see src/proxy.ts, and the outage that proved it.
 */

const nextConfig: NextConfig = {
  // Nothing gained by announcing the framework version to a scanner.
  poweredByHeader: false,

  /**
   * Where a listing's photographs come from.
   *
   * Hosts upload these, so they arrive at whatever size their phone produced —
   * which on a listing page is the largest thing on the screen and the thing
   * the page is waiting for. Letting Next resize and re-encode them is worth
   * more here than anywhere else on the site.
   *
   * Named by pattern rather than left open: `remotePatterns` is an allowlist,
   * and an open one turns the image optimiser into a proxy anybody can point
   * at anything.
   */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
