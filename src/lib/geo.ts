/**
 * Real coordinates, and the arithmetic that puts them on a screen.
 *
 * Pure functions over numbers — no fetching, no DOM — so the projection can be
 * tested against known landmarks rather than eyeballed against a picture.
 */

/** A point on Earth. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** One address a host might have meant, as offered in the dropdown. */
export interface AddressSuggestion {
  /** Stable key for React and for de-duplication. */
  id: string;
  /** The bold first line: house number and street, or the place's name. */
  primary: string;
  /** City, region, country — what tells two identical street names apart. */
  secondary: string;
  /** What lands in the address field once chosen. */
  addressLine: string;
  lat: number;
  lng: number;
}

export const TILE_SIZE = 256;

/**
 * Zoom for the host's confirmation map.
 *
 * 16 shows the building and its neighbours. Lower and a host cannot tell which
 * corner of the block was picked; higher and there is not enough context to
 * recognise the street at all.
 */
export const ADDRESS_ZOOM = 16;

/** Web Mercator, the projection every raster tile provider uses. */
export function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat: number, zoom: number): number {
  // Clamped to Mercator's limit: the projection sends the poles to infinity.
  const clamped = Math.min(85.05112878, Math.max(-85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

export function tileXToLng(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * (y / 2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Where a point falls inside a map box centred on another point.
 *
 * Returns pixels from the box's top-left, which may be outside it — the caller
 * decides whether an off-screen pin is clipped or is a reason to recentre.
 */
export function pointToPixel(
  point: LatLng,
  centre: LatLng,
  zoom: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const dx = (lngToTileX(point.lng, zoom) - lngToTileX(centre.lng, zoom)) * TILE_SIZE;
  const dy = (latToTileY(point.lat, zoom) - latToTileY(centre.lat, zoom)) * TILE_SIZE;
  return { x: width / 2 + dx, y: height / 2 + dy };
}

/** The inverse: what a host meant by tapping there. */
export function pixelToPoint(
  pixel: { x: number; y: number },
  centre: LatLng,
  zoom: number,
  width: number,
  height: number,
): LatLng {
  const tileX = lngToTileX(centre.lng, zoom) + (pixel.x - width / 2) / TILE_SIZE;
  const tileY = latToTileY(centre.lat, zoom) + (pixel.y - height / 2) / TILE_SIZE;
  return { lat: tileYToLat(tileY, zoom), lng: tileXToLng(tileX, zoom) };
}

/** Degrees per cell before a coordinate is allowed near the browse map. */
const CELL_DEGREES = 0.1;

/** Which ~11 km cell a coordinate falls in, without floating-point drift. */
function cellIndex(value: number): number {
  return Math.floor(Math.round(value * 1e6) / (CELL_DEGREES * 1e6));
}

/** Integer mix, spread evenly over [0,1). Deterministic across runs and machines. */
function spread(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000;
}

/**
 * Position on the *illustrated* browse map, which is a different job entirely.
 *
 * A listing's street address is private until someone books it, so the map on
 * Discover must not be a locator. It stays an abstract drawing, and this only
 * decides where on that drawing a pin sits.
 *
 * The coordinate is first reduced to which tenth-of-a-degree cell it falls in
 * — roughly 11 km — and only the cell reaches the picture. Two studios in the
 * same neighbourhood therefore land on the same spot, which is what makes the
 * result unreadable backwards: there is no street left in it to recover. The
 * cell is then spread through an integer mix rather than laid out
 * geographically, so the drawing carries no bearing or distance either.
 *
 * That is the trade. The picture is decoration that stays put per listing; it
 * is not, and must not become, a way to find anybody.
 */
export function toBrowsePosition(point: LatLng): { mapX: number; mapY: number } {
  // Both axes from the same cell pair, so one cell is one spot on the picture.
  const cell = Math.imul(cellIndex(point.lat), 73856093) ^ Math.imul(cellIndex(point.lng), 19349663);

  return {
    mapX: Math.round((6 + spread(cell) * 88) * 10) / 10,
    mapY: Math.round((8 + spread(cell ^ 0x5bd1e995) * 84) * 10) / 10,
  };
}

/**
 * The tiles covering a box, as a grid the caller can lay out directly.
 *
 * `offsetX`/`offsetY` are negative: how far the first tile is shifted so the
 * centre point lands in the middle rather than on a tile boundary.
 */
export function tileGrid(
  centre: LatLng,
  zoom: number,
  width: number,
  height: number,
): {
  zoom: number;
  tiles: { x: number; y: number; key: string; left: number; top: number }[];
  offsetX: number;
  offsetY: number;
} {
  const centreX = lngToTileX(centre.lng, zoom);
  const centreY = latToTileY(centre.lat, zoom);

  const firstX = Math.floor(centreX - width / 2 / TILE_SIZE);
  const firstY = Math.floor(centreY - height / 2 / TILE_SIZE);
  const lastX = Math.floor(centreX + width / 2 / TILE_SIZE);
  const lastY = Math.floor(centreY + height / 2 / TILE_SIZE);

  const offsetX = width / 2 - (centreX - firstX) * TILE_SIZE;
  const offsetY = height / 2 - (centreY - firstY) * TILE_SIZE;

  const span = 2 ** zoom;
  const tiles = [];
  for (let y = firstY; y <= lastY; y++) {
    // Above the north pole or below the south there is no tile to ask for.
    if (y < 0 || y >= span) continue;
    for (let x = firstX; x <= lastX; x++) {
      // Longitude wraps, so a box straddling the date line is still covered.
      const wrapped = ((x % span) + span) % span;
      tiles.push({
        x: wrapped,
        y,
        key: `${x}:${y}`,
        left: offsetX + (x - firstX) * TILE_SIZE,
        top: offsetY + (y - firstY) * TILE_SIZE,
      });
    }
  }

  return { zoom, tiles, offsetX, offsetY };
}
