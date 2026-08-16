import { headers } from "next/headers";

import { crawlPolicyFor, sitemapFor } from "@/lib/site-map";

/** Per request, for the same reason robots.txt is. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const list = await headers();
  const host = list.get("host");
  const proto = list.get("x-forwarded-proto") ?? "https";

  // Nothing to offer from a hostname we are asking not to be indexed.
  if (crawlPolicyFor(host) === "hidden") {
    return new Response("Not found", { status: 404 });
  }

  return new Response(sitemapFor(`${proto}://${host}`), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
