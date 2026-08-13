/**
 * Where the map's pictures come from, and who has to be credited for them.
 *
 * Both maps hard-coded `tile.openstreetmap.org`. That is a volunteer-funded
 * service whose usage policy does not cover an app like this one, and it
 * enforces the policy by serving a picture that says "Access blocked" with a
 * 200 beside it. Nothing throws, no request fails, and `onError` never fires —
 * the map simply becomes a wall of notices, on both screens at once, with the
 * app none the wiser.
 *
 * So the host is configuration rather than code. Moving to a provider with a
 * contract behind it is then a variable in Vercel, not an edit and a deploy,
 * which matters on the day it happens because that day will look like the maps
 * breaking for no reason.
 *
 * The attribution moves with it. It is not decoration: every tile provider
 * requires a specific credit, and one naming OpenStreetMap over somebody
 * else's tiles is wrong in the direction that costs money.
 */

/** OpenStreetMap, kept as the default so development needs no key. */
const DEFAULT_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION = "© OpenStreetMap";

/**
 * `{z}`, `{x}` and `{y}` are filled per tile. A key, where a provider wants
 * one, rides in the query string — which is why this is a whole URL rather
 * than a host.
 */
export const TILE_TEMPLATE = process.env.NEXT_PUBLIC_MAP_TILE_URL || DEFAULT_TEMPLATE;

export const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || DEFAULT_ATTRIBUTION;

/**
 * The origin the policy has to allow.
 *
 * Derived from the template rather than configured separately: two variables
 * that must agree are two variables that will not, and the failure is a blank
 * map with a console message nobody is watching for.
 */
export const TILE_ORIGIN = (() => {
  try {
    return new URL(TILE_TEMPLATE).origin;
  } catch {
    // A malformed template would otherwise take the middleware down with it,
    // and a broken map is better than a site that will not render.
    return new URL(DEFAULT_TEMPLATE).origin;
  }
})();

export function tileUrl(zoom: number, x: number, y: number): string {
  return TILE_TEMPLATE.replace("{z}", String(zoom))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
