import { distanceBetween } from "./distance";

/**
 * Where we can actually find somebody to book the room.
 *
 * A marketplace is only worth joining where both sides are, and at launch both
 * sides are in one metro. A studio in Ohio can list a room here today and the
 * honest forecast for it is zero bookings, ever — they would photograph the
 * space, write the description, upload a lease, set up payouts, and wait for
 * nobody. Taking that work and saying nothing is the dishonest option, and it
 * is the one every empty marketplace picks.
 *
 * So the area is stated, out loud, at the moment the address is chosen —
 * before any of that work is done rather than after.
 *
 * This is a launch boundary, not a permanent one. It moves by editing the two
 * numbers below.
 */

/** Roughly Hayward: the middle of the bay rather than the middle of a city. */
const CENTRE = { lat: 37.6688, lng: -122.0808 };

/**
 * Far enough to hold San Francisco, the whole peninsula down to San Jose, and
 * the East Bay up to Berkeley. Deliberately generous at the edge: refusing a
 * studio in Fairfield costs us a room, and the person deciding whether the
 * drive is worth it is the practitioner, not us.
 */
const RADIUS_MILES = 45;

export interface Point {
  lat: number;
  lng: number;
}

/** The area's name, for saying where we are rather than only where we are not. */
export const SERVICE_AREA_NAME = "the San Francisco Bay Area";

export function isInServiceArea(point: Point): boolean {
  return distanceBetween(CENTRE, point) <= RADIUS_MILES;
}

/**
 * How far outside, in whole miles, for a sentence that respects somebody's
 * judgement instead of just refusing.
 *
 * A studio eight miles past the line reads "about eight miles outside" and can
 * decide for themselves; "not available in your area" tells them nothing and
 * reads like a bug when their neighbour two towns over is listed.
 */
export function milesOutside(point: Point): number {
  const over = distanceBetween(CENTRE, point) - RADIUS_MILES;
  return over <= 0 ? 0 : Math.max(1, Math.round(over));
}
