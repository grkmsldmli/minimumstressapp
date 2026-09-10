import type { NextRequest } from "next/server";

import {
  MAX_NEARBY_MILES,
  isPostalCode,
  normalisePostalCode,
  sortByDistance,
} from "@/lib/distance";
import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { requireUser } from "@/lib/api/session";
import type { LatLng } from "@/lib/geo";
import { geocodeOne } from "@/lib/geocode";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Listings, nearest first.
 *
 * The sort has to happen here, and that is the whole design. `spaces_public`
 * carries no coordinates on purpose — a room's address is private until
 * somebody books it — so the alternative would be publishing lat/lng to every
 * browser and sorting on the client, which is the same as publishing the
 * addresses. Instead the caller says where *it* is, the server reads the real
 * coordinates it already holds, and what comes back is an order and a coarse
 * label. Nothing in the response narrows a room to better than a tenth of a
 * mile.
 *
 * The caller's location is used and dropped. It is never written down, which
 * is both the honest thing and what the consent screen promises.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Distance ranking reads the exact coordinates no client may see, so it is for
  // the signed-in marketplace only (migration 0064 moved individual inventory
  // there). requireUser accepts the web cookie or the native bearer token; an
  // anonymous caller is turned away before any coordinate is read or geocoded.
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  // A ZIP lookup runs a geocode, so this endpoint is metered too, one step
  // removed.
  const limited = check("nearby", identify(request), LIMITS.nearby);
  if (!limited.ok) return tooManyRequests(limited);

  const params = request.nextUrl.searchParams;

  let origin: LatLng | null = null;

  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return Response.json({ error: "Those coordinates are not on Earth" }, { status: 400 });
    }
    origin = { lat, lng };
  } else {
    const postal = params.get("postalCode");
    if (postal) {
      if (!isPostalCode(postal)) {
        return Response.json({ error: "That doesn't look like a ZIP code" }, { status: 400 });
      }
      origin = await locatePostalCode(normalisePostalCode(postal));
      if (!origin) {
        return Response.json({ error: "We couldn't find that ZIP code" }, { status: 404 });
      }
    }
  }

  if (!origin) {
    return Response.json({ error: "Send lat and lng, or a postalCode" }, { status: 400 });
  }

  /**
   * Read with the service role, because the coordinates being sorted on are
   * exactly the ones no client may see. The rows are filtered to active
   * listings here rather than relying on a view, since this query deliberately
   * steps outside the one that hides them.
   */
  const { data, error } = await supabaseAdmin()
    .from("spaces")
    .select("id, lat, lng")
    .eq("status", "active");

  if (error) {
    console.error("Nearby lookup failed:", error);
    return Response.json({ error: "Could not load spaces" }, { status: 500 });
  }

  const ranked = sortByDistance(data ?? [], origin)
    // Beyond an hour's travel this is not a room anyone is booking for an
    // hour, and including it would make the list look full of nothing.
    .filter((entry) => entry.miles === null || entry.miles <= MAX_NEARBY_MILES);

  return Response.json(
    {
      // Ids and labels only. No coordinates, no bearing, no radius.
      spaces: ranked.map((entry) => ({ id: entry.item.id, distanceLabel: entry.label })),
    },
    // Depends on the caller's own position, so it is theirs alone and short-lived.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}

/**
 * Turns a ZIP into a point, through the geocoder the app already uses.
 *
 * The postal code is the path for someone who declined to share their
 * location, so it must not be worse for them: the code is validated before it
 * leaves us, and the query is scoped so a five-digit number cannot be read as
 * a street address somewhere else.
 */
async function locatePostalCode(code: string): Promise<LatLng | null> {
  try {
    const found = await geocodeOne(`${code} USA`, AbortSignal.timeout(6000));
    return found ? { lat: found.lat, lng: found.lng } : null;
  } catch (error) {
    console.error(`Could not locate ZIP ${code}:`, error);
    return null;
  }
}
