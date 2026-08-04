import type { AddressSuggestion } from "./geo";

/**
 * Turning a half-typed address into places a host can choose between.
 *
 * The provider is Photon, which is OpenStreetMap data served for exactly this
 * — typing one character at a time — and needs no key or billing account.
 * Parsing lives here rather than in the route so the shapes a real provider
 * returns can be tested without the network.
 */

const PHOTON_ENDPOINT = "https://photon.komoot.io/api";

/** Below this a query matches half the planet and the results are noise. */
export const MIN_QUERY_LENGTH = 3;

/** Enough to recognise the right one; more than fits under a text field. */
export const MAX_SUGGESTIONS = 6;

/** Photon's shape, narrowed to what we read. Everything is optional in practice. */
interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The line a host recognises at a glance.
 *
 * A street address wins when there is one, because that is what a host typed.
 * Named places — "Willow Yoga" — fall back to the name, which is often the
 * only thing they know; a bare street with no number is still worth offering
 * so they can pick it and nudge the pin.
 */
function primaryLine(p: Record<string, unknown>): string {
  const houseNumber = text(p.housenumber);
  const street = text(p.street);
  const name = text(p.name);

  if (street) return houseNumber ? `${houseNumber} ${street}` : street;
  return name;
}

/** City and country, which is what tells two identical street names apart. */
function secondaryLine(p: Record<string, unknown>): string {
  const locality = text(p.city) || text(p.town) || text(p.village) || text(p.county);
  const parts = [locality, text(p.state), text(p.country)].filter(Boolean);

  // A place with a street already showed its name above; one without did not.
  const name = text(p.name);
  if (name && text(p.street) && name !== primaryLine(p)) parts.unshift(name);

  return [...new Set(parts)].join(", ");
}

export function toSuggestions(payload: unknown): AddressSuggestion[] {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];

  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];

  for (const raw of features as PhotonFeature[]) {
    const coordinates = raw?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;

    // GeoJSON is [longitude, latitude] — the reverse of how everyone says it,
    // and the single easiest thing to get backwards in this whole file.
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const properties = (raw.properties ?? {}) as Record<string, unknown>;
    const primary = primaryLine(properties);
    if (!primary) continue;

    const secondary = secondaryLine(properties);
    const addressLine = [primary, secondary].filter(Boolean).join(", ");

    // Photon repeats a place across its building and its address node. The
    // text is what a host sees, so identical text is a duplicate regardless of
    // which OSM object produced it.
    if (seen.has(addressLine)) continue;
    seen.add(addressLine);

    out.push({
      id: `${text(properties.osm_type)}${properties.osm_id ?? ""}:${lat},${lng}`,
      primary,
      secondary,
      addressLine,
      lat,
      lng,
    });

    if (out.length === MAX_SUGGESTIONS) break;
  }

  return out;
}

/**
 * Asks the provider. Throws on a bad response so the route can decide what the
 * host sees — an empty dropdown and a working text field, never a crash.
 */
export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  // Asked for more than we show, because de-duplication thins the list.
  url.searchParams.set("limit", String(MAX_SUGGESTIONS * 3));

  const response = await fetch(url, {
    signal,
    headers: {
      // Photon is a free community service; identifying ourselves is the
      // courtesy that keeps it usable and makes us reachable if we misbehave.
      "User-Agent": "MinimumStressSpaces/1.0 (+https://minimumstress.app)",
      Accept: "application/json",
    },
  });

  if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);

  return toSuggestions(await response.json());
}
