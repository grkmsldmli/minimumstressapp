import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { zoneForPoint } from "@/lib/zone-for-point";

/**
 * The timezone a pin is standing in.
 *
 * Its own route rather than a field on the address, because a host can also
 * place the pin by tapping the map, and that path never asks a geocoder
 * anything. One endpoint covers both ways of choosing a spot.
 *
 * Nothing here is private: the caller already knows the coordinates, and the
 * answer is a public fact about the map. Rate limited anyway — it is reachable
 * by anyone and does real work per call.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const limited = check("geocode-zone", identify(request), LIMITS.geocode);
  if (!limited.ok) return tooManyRequests(limited);

  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lng = Number(request.nextUrl.searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat and lng are required" }, { status: 400 });
  }

  return Response.json(
    { timezone: zoneForPoint(lat, lng) },
    {
      // Boundaries move about once a decade. A day of caching is nothing.
      headers: { "Cache-Control": "public, max-age=86400" },
    },
  );
}
