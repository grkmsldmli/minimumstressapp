import { headers } from "next/headers";

import { robotsFor } from "@/lib/site-map";

/**
 * A route handler rather than Next's `robots.ts`.
 *
 * The convention generates one file at build time with no request to read, and
 * this deployment answers to three hostnames that need three different
 * answers — the app, the content site, and the staging name, which must stay
 * closed to crawlers so it does not get indexed as a second copy of the site
 * it is a draft of.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const list = await headers();
  const host = list.get("host");
  const proto = list.get("x-forwarded-proto") ?? "https";

  return new Response(robotsFor(host, `${proto}://${host}`), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
