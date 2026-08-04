import type { AddressSuggestion } from "./geo";
import { normalizeQuery, rankSuggestions } from "./geocode-query";

/**
 * Turning a half-typed address into places a host can choose between.
 *
 * Two providers, because the free keyless one is not good enough on its own.
 * Measured against a real address — 1301 West Hillsdale Boulevard, San Mateo —
 * Photon returned an alley in Sacramento, then with the abbreviations expanded
 * the right street but the wrong building, 1700 instead of 1301. A pin a block
 * from the studio is worse than no pin, because it looks correct.
 *
 * The data is not the problem: the same OpenStreetMap address is found exactly
 * by Nominatim's engine. Nominatim itself forbids autocomplete use, so the
 * preferred provider is LocationIQ, which runs that engine commercially and
 * allows it. Photon stays as the keyless fallback so the field still works
 * before anyone has signed up for anything.
 */

const PHOTON_ENDPOINT = "https://photon.komoot.io/api";
/**
 * Search, not the autocomplete endpoint, despite this being an autocomplete.
 *
 * Measured against both: `/autocomplete` answered "1301 w hillsdale blv" with
 * 1301 Summit Boulevard in West Palm Beach — it matches the number as a prefix
 * and is loose about the rest. `/search` returned 1301 West Hillsdale
 * Boulevard, San Mateo, first and exactly, with no city in the query at all,
 * and got every other test address right too.
 *
 * The endpoint named after the feature was the wrong one. Debounced typing
 * makes a full geocode per pause affordable, and both cost the same against
 * the quota.
 */
const LOCATIONIQ_ENDPOINT = "https://us1.locationiq.com/v1/search";

/** Below this a query matches half the planet and the results are noise. */
export const MIN_QUERY_LENGTH = 3;

/** Enough to recognise the right one; more than fits under a text field. */
export const MAX_SUGGESTIONS = 6;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Which provider is in play, so the route can say so and tests can assert it. */
export function activeProvider(): "locationiq" | "photon" {
  return process.env.LOCATIONIQ_API_KEY ? "locationiq" : "photon";
}

/* ------------------------------------------------------------------ */
/* Photon                                                              */
/* ------------------------------------------------------------------ */

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
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

  const name = text(p.name);
  if (name && text(p.street) && name !== primaryLine(p)) parts.unshift(name);

  return [...new Set(parts)].join(", ");
}

export function toSuggestions(payload: unknown): AddressSuggestion[] {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];

  return collect(
    (features as PhotonFeature[]).map((raw) => {
      const coordinates = raw?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

      // GeoJSON is [longitude, latitude] — the reverse of how everyone says it,
      // and the single easiest thing to get backwards in this whole file.
      const properties = (raw.properties ?? {}) as Record<string, unknown>;
      return {
        lng: Number(coordinates[0]),
        lat: Number(coordinates[1]),
        primary: primaryLine(properties),
        secondary: secondaryLine(properties),
        id: `${text(properties.osm_type)}${properties.osm_id ?? ""}`,
      };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* LocationIQ                                                          */
/* ------------------------------------------------------------------ */

interface LocationIqResult {
  place_id?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, unknown>;
}

export function toSuggestionsFromLocationIq(payload: unknown): AddressSuggestion[] {
  // The API answers an empty search with an error object rather than an empty
  // array, so anything that is not a list means "no results" here.
  if (!Array.isArray(payload)) return [];

  return collect(
    (payload as LocationIqResult[]).map((row) => {
      const address = (row.address ?? {}) as Record<string, unknown>;
      const houseNumber = text(address.house_number);
      const road = text(address.road);
      const name = text(address.name);

      const primary = road ? [houseNumber, road].filter(Boolean).join(" ") : name;

      const locality =
        text(address.city) || text(address.town) || text(address.village) || text(address.county);
      const parts = [locality, text(address.state), text(address.country)].filter(Boolean);
      if (name && road && name !== houseNumber) parts.unshift(name);

      return {
        lat: Number(row.lat),
        lng: Number(row.lon),
        primary,
        secondary: [...new Set(parts)].join(", "),
        id: text(row.place_id),
      };
    }),
  );
}

/* ------------------------------------------------------------------ */

/** Validates, de-duplicates and caps whatever a provider produced. */
function collect(
  rows: ({ lat: number; lng: number; primary: string; secondary: string; id: string } | null)[],
): AddressSuggestion[] {
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];

  for (const row of rows) {
    if (!row) continue;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
    if (row.lat < -90 || row.lat > 90 || row.lng < -180 || row.lng > 180) continue;
    if (!row.primary) continue;

    const addressLine = [row.primary, row.secondary].filter(Boolean).join(", ");

    // Providers repeat a place across its building and its address node. The
    // text is what a host sees, so identical text is a duplicate regardless of
    // which underlying object produced it.
    if (seen.has(addressLine)) continue;
    seen.add(addressLine);

    out.push({
      id: `${row.id}:${row.lat},${row.lng}`,
      primary: row.primary,
      secondary: row.secondary,
      addressLine,
      lat: row.lat,
      lng: row.lng,
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
  // Expanded before sending, not after: it changes what the provider looks for.
  const normalized = normalizeQuery(query);
  if (normalized.length < MIN_QUERY_LENGTH) return [];

  const key = process.env.LOCATIONIQ_API_KEY;
  const url = key ? locationIqUrl(normalized, key) : photonUrl(normalized);

  const response = await fetch(url, {
    signal,
    headers: {
      // Identifying ourselves is the courtesy that keeps a free service usable
      // and makes us reachable if we ever misbehave.
      "User-Agent": "MinimumStress/1.0 (+https://minimumstress.app)",
      Accept: "application/json",
    },
  });

  // LocationIQ answers "nothing matched" with 404 rather than an empty list.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);

  const payload = await response.json();
  const suggestions = key ? toSuggestionsFromLocationIq(payload) : toSuggestions(payload);

  // Ranked against what was typed, not what was sent, so a house number the
  // normaliser left alone still decides the order.
  return rankSuggestions(suggestions, query);
}

function photonUrl(query: string): URL {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  // Asked for more than we show, because de-duplication and ranking thin the list.
  url.searchParams.set("limit", String(MAX_SUGGESTIONS * 3));
  return url;
}

function locationIqUrl(query: string, key: string): URL {
  const url = new URL(LOCATIONIQ_ENDPOINT);
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(MAX_SUGGESTIONS * 2));
  url.searchParams.set("format", "json");
  // Without this the response carries no house number, city or road to build a
  // suggestion from — only a single run-on display string.
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("dedupe", "1");
  // Cities returned in their common form rather than the administrative one,
  // so a host sees "San Mateo" and not "San Mateo County".
  url.searchParams.set("normalizecity", "1");
  return url;
}
