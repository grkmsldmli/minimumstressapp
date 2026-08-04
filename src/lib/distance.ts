import type { LatLng } from "./geo";

/**
 * How far apart two points are, and how to say it.
 *
 * Pure, and deliberately separate from the geocoding module: this is the only
 * part of nearby search that ever touches a listing's real coordinates, and it
 * runs on the server. `spaces_public` has no lat/lng at all — a listing's
 * address is private until someone books it — so the client sends where it is,
 * the server sorts, and only a label like "0.8 mi" comes back. Distance is
 * useful; a bearing and a radius would be a locator.
 */

const EARTH_RADIUS_MILES = 3958.8;
const EARTH_RADIUS_KM = 6371;

export type DistanceUnit = "mi" | "km";

/**
 * Great-circle distance. Haversine rather than a flat approximation because
 * the error near the poles is not worth the handful of operations saved, and
 * because a wrong distance here reads as a lie rather than a rounding.
 */
export function distanceBetween(a: LatLng, b: LatLng, unit: DistanceUnit = "mi"): number {
  const radius = unit === "mi" ? EARTH_RADIUS_MILES : EARTH_RADIUS_KM;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The label a practitioner reads.
 *
 * Coarsened on purpose, and increasingly so with distance. "0.8 mi" is what
 * someone needs to decide whether to walk; "0.83 mi" additionally narrows
 * where a room is, and three such labels from three known points would place
 * it exactly. Under a tenth of a mile it stops being a number at all, because
 * at that range the precision is the address.
 */
export function distanceLabel(miles: number, unit: DistanceUnit = "mi"): string {
  if (miles < 0.1) return "Nearby";
  if (miles < 10) return `${miles.toFixed(1)} ${unit}`;
  if (miles < 100) return `${Math.round(miles)} ${unit}`;
  return `${Math.round(miles / 10) * 10}+ ${unit}`;
}

/** Beyond this, a room is not somewhere anyone is travelling for an hour. */
export const MAX_NEARBY_MILES = 60;

export interface Locatable {
  lat: number | null;
  lng: number | null;
}

/**
 * Orders listings by how far away they are, and labels each one.
 *
 * A listing with no coordinates keeps its place rather than being dropped:
 * older rows predate geocoding, and disappearing from search is a worse
 * failure than appearing without a distance. They sort last, because "we do
 * not know" should not outrank "half a mile away".
 */
export function sortByDistance<T extends Locatable>(
  items: T[],
  from: LatLng,
  unit: DistanceUnit = "mi",
): { item: T; miles: number | null; label: string }[] {
  return items
    .map((item) => {
      if (item.lat === null || item.lng === null) {
        return { item, miles: null, label: "Distance unknown" };
      }
      const miles = distanceBetween(from, { lat: item.lat, lng: item.lng }, unit);
      return { item, miles, label: distanceLabel(miles, unit) };
    })
    .sort((a, b) => {
      if (a.miles === null && b.miles === null) return 0;
      if (a.miles === null) return 1;
      if (b.miles === null) return -1;
      return a.miles - b.miles;
    });
}

/**
 * US ZIP, five digits or ZIP+4.
 *
 * Validated before it reaches a geocoder rather than after: a postal code is
 * the one input here typed by someone who declined to share their location,
 * and sending whatever they typed to a third party would undo the point of
 * offering the alternative.
 */
export function isPostalCode(value: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(value.trim());
}

/** The five digits a geocoder wants, from either form. */
export function normalisePostalCode(value: string): string {
  return value.trim().slice(0, 5);
}
