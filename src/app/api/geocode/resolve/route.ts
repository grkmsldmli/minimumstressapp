import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { resolveGooglePlace } from "@/lib/geocode-google";

/**
 * Turns a chosen prediction into coordinates.
 *
 * Only the predictive provider needs this. A geocoder answers "what" and
 * "where" in one call, so its suggestions arrive with coordinates already
 * attached and the client never comes here.
 *
 * The session token matters as much as the place id: it is what ties this
 * lookup to the keystrokes that produced it, and Google bills the pair as one
 * session rather than the details call separately.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const limited = check("geocode-resolve", identify(request), LIMITS.geocodeResolve);
  if (!limited.ok) return tooManyRequests(limited);

  const placeId = request.nextUrl.searchParams.get("placeId");
  const sessionToken = request.nextUrl.searchParams.get("session");

  if (!placeId || !sessionToken) {
    return Response.json({ error: "placeId and session are required" }, { status: 400 });
  }

  try {
    const resolved = await resolveGooglePlace(placeId, sessionToken, AbortSignal.timeout(5000));

    // Null means the provider knows the id but not where it is, which is not
    // an error we can do anything about — the caller keeps the typed text and
    // the host places the pin themselves.
    if (!resolved) return Response.json({ resolved: null });

    return Response.json({ resolved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Place resolution failed:", error);
    return Response.json({ resolved: null, degraded: true });
  }
}
