import type { NextRequest } from "next/server";

import { activeProvider, MIN_QUERY_LENGTH, searchAddresses } from "@/lib/geocode";

/**
 * Address lookup, proxied rather than called from the browser.
 *
 * Three reasons it goes through us. A host's half-typed home address is not
 * something to hand to a third party from their own IP. Swapping providers is
 * one file rather than a client rebuild. And the API key never reaches the
 * browser, which for a metered provider is the difference between a key we
 * control and one anybody can lift from the network tab and spend.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const sessionToken = request.nextUrl.searchParams.get("session") ?? undefined;

  // Not an error — it is what every field looks like before anyone types.
  if (query.length < MIN_QUERY_LENGTH) return Response.json({ suggestions: [] });

  // Long enough to be a real address, short enough that nobody is using this
  // endpoint to push a payload at the provider on our behalf.
  if (query.length > 200) return Response.json({ suggestions: [] });

  try {
    const suggestions = await searchAddresses(query, {
      sessionToken,
      signal: AbortSignal.timeout(4000),
    });

    return Response.json(
      { suggestions, provider: activeProvider() },
      {
        /**
         * Not cached.
         *
         * It was, for a minute, and that minute cost an afternoon: after the
         * provider changed, the browser kept serving the old provider's answer
         * and the field looked broken while the server was already correct.
         * Predictions are per-keystroke and per-session anyway — there is
         * almost nothing to reuse, and the one thing a cache reliably does
         * here is hide a change.
         */
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    /**
     * A degraded dropdown, never a blocked form.
     *
     * The address field accepts free text on its own, so a provider that is
     * down or slow costs a host the suggestions and nothing else. Returning an
     * error status here would light up an alarm on a screen where the correct
     * behaviour is to carry on typing.
     */
    console.error("Address lookup failed:", error);
    return Response.json({ suggestions: [], degraded: true });
  }
}
