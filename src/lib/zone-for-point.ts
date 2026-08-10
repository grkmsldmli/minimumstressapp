import tzLookup from "tz-lookup";

import { FALLBACK_ZONE, isKnownZone } from "./timezone";

/**
 * Which timezone covers a point on the map.
 *
 * Server-only, and the import is the reason: `tz-lookup` carries a compressed
 * copy of the world's timezone boundaries, which is a fine thing to keep on a
 * server and a waste to send to a phone. The browser asks the route in
 * `app/api/geocode/zone` and stores the string it gets back.
 *
 * Neither geocoding provider returns a zone, so this is a separate lookup
 * rather than a field on the address — but it is offline and needs no key, so
 * it costs a function call rather than a request.
 */
export function zoneForPoint(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return FALLBACK_ZONE;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return FALLBACK_ZONE;

  try {
    const zone = tzLookup(lat, lng);

    /*
     * The table is older than the zone database this runtime carries, and zones
     * do get renamed. A name we cannot resolve is worse than a wrong-but-usable
     * one, because every render of that listing would throw inside Intl.
     */
    return isKnownZone(zone) ? zone : FALLBACK_ZONE;
  } catch {
    // Open ocean, mostly. No room is there, but the caller still needs a string.
    return FALLBACK_ZONE;
  }
}
