import { headers } from "next/headers";

import { generatedPaths } from "@/lib/directory-data";
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

  /*
   * The towns are read per request rather than pinned at build time, because
   * inventory is the thing that changes: a room listed this morning should be
   * findable this afternoon, and a town that dropped below the threshold
   * should stop being advertised without waiting for a deploy.
   *
   * A database that cannot be reached returns nothing rather than throwing —
   * a sitemap missing its towns for an hour is recoverable, and a 500 here is
   * a crawler being told the file is broken.
   */
  return new Response(sitemapFor(`${proto}://${host}`, await generatedPaths()), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
