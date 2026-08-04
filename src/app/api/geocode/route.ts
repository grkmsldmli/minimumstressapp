import type { NextRequest } from "next/server";

import { MIN_QUERY_LENGTH, searchAddresses } from "@/lib/geocode";

/**
 * Address lookup, proxied rather than called from the browser.
 *
 * Three reasons it goes through us. A host's half-typed home address is not
 * something to hand to a third party from their own IP. Swapping Photon for a
 * paid provider later becomes one file rather than a client rebuild. And the
 * provider's rate limit applies to our server, where it can be reasoned about,
 * instead of to whichever host happens to type fastest.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();

  // Not an error — it is what every field looks like before anyone types.
  if (query.length < MIN_QUERY_LENGTH) return Response.json({ suggestions: [] });

  // Long enough to be a real address, short enough that nobody is using this
  // endpoint to push a payload at the provider on our behalf.
  if (query.length > 200) return Response.json({ suggestions: [] });

  try {
    const suggestions = await searchAddresses(query, AbortSignal.timeout(4000));
    return Response.json(
      { suggestions },
      {
        // Hosts retype the same streets while correcting a typo, and the
        // provider is a free service. Private, because the query is the
        // host's own address.
        headers: { "Cache-Control": "private, max-age=60" },
      },
    );
  } catch (error) {
    /**
     * A degraded dropdown, never a blocked form.
     *
     * The address field accepts free text on its own, so a geocoder that is
     * down or slow costs a host the suggestions and nothing else. Returning an
     * error status here would light up an alarm on a screen where the correct
     * behaviour is to carry on typing.
     */
    console.error("Address lookup failed:", error);
    return Response.json({ suggestions: [], degraded: true });
  }
}
