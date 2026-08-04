import type { AddressSuggestion, ResolvedAddress } from "./geo";

/**
 * Google Places, which is what the apps people compare us to actually use.
 *
 * Different in kind from the geocoders this file sits beside. A geocoder is
 * asked "where is this address" and answers well when handed a complete one;
 * measured against ours, "1301 w hillsd" resolved and "1301 w hillsdale" —
 * three characters more of the same address — returned nothing at all, because
 * partial input is not the question it answers. Places predicts from the first
 * few characters, tolerates a typo, and knows business names.
 *
 * The cost of that is two calls instead of one: predictions carry no
 * coordinates, and a chosen place is exchanged for them afterwards. A session
 * token ties the keystrokes and the final lookup together so Google bills the
 * whole thing once rather than per keystroke — forgetting it is the difference
 * between a rounding error and a real invoice.
 */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

interface GooglePrediction {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
}

export function toSuggestionsFromGoogle(payload: unknown): AddressSuggestion[] {
  const raw = (payload as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(raw)) return [];

  const out: AddressSuggestion[] = [];

  for (const entry of raw as GooglePrediction[]) {
    const prediction = entry?.placePrediction;
    const placeId = prediction?.placeId;
    if (!placeId) continue;

    // structuredFormat is the split Google already made between the thing and
    // where it is — the same two lines the dropdown wants. `text` is the two
    // joined back together, used only when the split is missing.
    const primary = prediction.structuredFormat?.mainText?.text?.trim() ?? "";
    const secondary = prediction.structuredFormat?.secondaryText?.text?.trim() ?? "";
    const joined = prediction.text?.text?.trim() ?? "";

    if (!primary && !joined) continue;

    out.push({
      id: placeId,
      placeId,
      primary: primary || joined,
      secondary: primary ? secondary : "",
      addressLine: joined || [primary, secondary].filter(Boolean).join(", "),
      // Deliberately absent. The prediction does not know, and inventing a
      // zero here would put every unresolved pin in the Gulf of Guinea.
      lat: null,
      lng: null,
    });
  }

  return out;
}

export async function predictAddresses(
  query: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");

  const response = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      // Billed by which fields are asked for, so this asks for the ones the
      // dropdown draws and nothing else.
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input: query,
      sessionToken,
      // The room is somewhere a practitioner physically walks into, so a
      // prediction on another continent is never the answer.
      includedRegionCodes: ["us"],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Places autocomplete ${response.status}: ${detail.slice(0, 200)}`);
  }

  return toSuggestionsFromGoogle(await response.json());
}

/**
 * Exchanges a chosen prediction for the coordinates it never carried.
 *
 * The same session token as the keystrokes that led here, which is what closes
 * the session and settles the bill for it.
 */
export async function resolveGooglePlace(
  placeId: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<ResolvedAddress | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");

  const url = new URL(`${DETAILS_URL}/${encodeURIComponent(placeId)}`);
  url.searchParams.set("sessionToken", sessionToken);

  const response = await fetch(url, {
    signal,
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "location,formattedAddress",
    },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    location?: { latitude?: number; longitude?: number };
    formattedAddress?: string;
  };

  const lat = payload.location?.latitude;
  const lng = payload.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    addressLine: payload.formattedAddress?.trim() ?? "",
    lat,
    lng,
  };
}
