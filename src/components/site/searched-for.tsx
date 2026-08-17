"use client";

import { useSearchParams } from "next/navigation";

import { spaceTypeBySlug } from "@/lib/space-types";

/**
 * What was searched for, said back.
 *
 * Without this the search box looks broken. Somebody picks "Pilates Studio" in
 * "San Mateo", lands on a page that says "nothing is listed yet", and cannot
 * tell whether that is the answer to their question or a form that failed
 * silently — which are very different things to a person deciding whether this
 * site works.
 *
 * On the client rather than on the server, for two reasons that point the same
 * way. The page itself is static and cached, so a server-rendered echo would
 * be the first visitor's search shown to everybody after them. And a search is
 * not a page: /spaces?type=…&where=… should never be indexed as its own
 * address — that is the faceted-URL sprawl this part of the site is careful
 * about — so the canonical stays on /spaces and this line is for the reader
 * only.
 */
export function SearchedFor() {
  const params = useSearchParams();

  const type = spaceTypeBySlug(params.get("type") ?? "");
  // Trimmed and capped: it is echoed back onto the page, and a paragraph of
  // somebody's pasted text is not a town.
  const where = (params.get("where") ?? "").trim().slice(0, 60);

  if (!type && !where) return <NothingYet />;

  return (
    <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
      No {type ? type.plural.toLowerCase() : "spaces"}
      {where ? ` in ${where}` : ""} yet. Nothing at all is listed so far — we are opening in the
      Bay Area first: San Francisco, the peninsula down to San Jose, and the East Bay.
    </p>
  );
}

/**
 * The same answer with no search behind it.
 *
 * Exported because it is also the Suspense fallback on the page: it is what a
 * crawler is served and what somebody with no JavaScript reads, which means
 * the honest sentence is in the HTML either way and only the personalised
 * version of it needs the client.
 */
export function NothingYet() {
  return (
    <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
      Nothing is listed yet. We are opening in the Bay Area first — San Francisco, the peninsula
      down to San Jose, and the East Bay.
    </p>
  );
}
