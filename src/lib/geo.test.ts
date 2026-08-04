import { describe, expect, it } from "vitest";

import {
  ADDRESS_ZOOM,
  type LatLng,
  latToTileY,
  lngToTileX,
  pixelToPoint,
  pointToPixel,
  tileGrid,
  tileXToLng,
  tileYToLat,
  toBrowsePosition,
} from "./geo";

/**
 * Projection maths is the kind of code that looks right and is silently wrong
 * by a factor of two, so these check against tile numbers that can be verified
 * independently — openstreetmap.org serves these exact tiles at these exact
 * URLs.
 */
describe("web mercator", () => {
  it("puts the origin at the centre of the world at zoom 0", () => {
    expect(lngToTileX(0, 0)).toBeCloseTo(0.5, 10);
    expect(latToTileY(0, 0)).toBeCloseTo(0.5, 10);
  });

  /**
   * Quadrants, which need no lookup table to agree with: at zoom 1 the world
   * is four tiles, and which one a place lands in is not a matter of opinion.
   * This is what catches a flipped sign or a factor of two — the errors that
   * still produce plausible-looking numbers.
   */
  it.each([
    ["north-west", 51.5, -0.1, 0, 0],
    ["north-east", 41.0, 29.0, 1, 0],
    ["south-west", -23.5, -46.6, 0, 1],
    ["south-east", -33.9, 151.2, 1, 1],
  ])("puts %s in its own quadrant at zoom 1", (_label, lat, lng, x, y) => {
    expect(Math.floor(lngToTileX(lng, 1))).toBe(x);
    expect(Math.floor(latToTileY(lat, 1))).toBe(y);
  });

  /**
   * Cross-check against the projection's other standard form. Mercator's y is
   * usually written with either ln(tan + sec) or asinh(tan); they are the same
   * function, so disagreement means the expression was transcribed wrong.
   */
  it("matches the asinh form of the same projection", () => {
    for (const lat of [-80, -45, -1, 0, 1, 37.5485, 51.4779, 80]) {
      const rad = (lat * Math.PI) / 180;
      const viaAsinh = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** 16;
      expect(latToTileY(lat, 16)).toBeCloseTo(viaAsinh, 6);
    }
  });

  it("clamps beyond Mercator's limit instead of returning infinity", () => {
    expect(Number.isFinite(latToTileY(90, 16))).toBe(true);
    expect(Number.isFinite(latToTileY(-90, 16))).toBe(true);
  });

  it.each([
    ["equator", 0, 0],
    ["San Mateo", 37.5485, -122.3122],
    ["Istanbul", 41.0082, 28.9784],
    ["Sydney", -33.8688, 151.2093],
  ])("round-trips %s through tile coordinates", (_label, lat, lng) => {
    const z = ADDRESS_ZOOM;
    expect(tileYToLat(latToTileY(lat, z), z)).toBeCloseTo(lat, 9);
    expect(tileXToLng(lngToTileX(lng, z), z)).toBeCloseTo(lng, 9);
  });
});

describe("pixel projection", () => {
  const centre: LatLng = { lat: 37.5485, lng: -122.3122 };

  it("draws the centre point in the middle of the box", () => {
    const { x, y } = pointToPixel(centre, centre, ADDRESS_ZOOM, 320, 150);
    expect(x).toBeCloseTo(160, 6);
    expect(y).toBeCloseTo(75, 6);
  });

  it("puts north up and east right", () => {
    const north = pointToPixel({ lat: 37.56, lng: -122.3122 }, centre, ADDRESS_ZOOM, 320, 150);
    const east = pointToPixel({ lat: 37.5485, lng: -122.3 }, centre, ADDRESS_ZOOM, 320, 150);

    expect(north.y).toBeLessThan(75);
    expect(east.x).toBeGreaterThan(160);
  });

  /** The tap-to-adjust path: a host's finger must land where they aimed. */
  it("round-trips a tap back to the point it represents", () => {
    const tapped = pixelToPoint({ x: 210, y: 40 }, centre, ADDRESS_ZOOM, 320, 150);
    const back = pointToPixel(tapped, centre, ADDRESS_ZOOM, 320, 150);

    expect(back.x).toBeCloseTo(210, 6);
    expect(back.y).toBeCloseTo(40, 6);
  });
});

describe("tileGrid", () => {
  const centre: LatLng = { lat: 37.5485, lng: -122.3122 };

  it("covers the whole box", () => {
    const width = 320;
    const height = 150;
    const { tiles } = tileGrid(centre, ADDRESS_ZOOM, width, height);

    expect(tiles.length).toBeGreaterThan(0);

    const left = Math.min(...tiles.map((t) => t.left));
    const top = Math.min(...tiles.map((t) => t.top));
    const right = Math.max(...tiles.map((t) => t.left + 256));
    const bottom = Math.max(...tiles.map((t) => t.top + 256));

    expect(left).toBeLessThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(width);
    expect(bottom).toBeGreaterThanOrEqual(height);
  });

  it("asks only for tiles that exist", () => {
    const span = 2 ** ADDRESS_ZOOM;
    for (const point of [
      { lat: 0, lng: 179.999 },
      { lat: 0, lng: -179.999 },
      { lat: 85, lng: 0 },
      { lat: -85, lng: 0 },
    ]) {
      for (const tile of tileGrid(point, ADDRESS_ZOOM, 320, 150).tiles) {
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x).toBeLessThan(span);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(span);
      }
    }
  });

  it("gives each tile a distinct key across the date line", () => {
    const { tiles } = tileGrid({ lat: 0, lng: 180 }, ADDRESS_ZOOM, 320, 150);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
  });
});

describe("toBrowsePosition", () => {
  /**
   * The illustration is 6..94 by 8..92 — a pin is drawn upward from its point,
   * so anything at the frame's edge renders half outside it. The database
   * constraint in 0008 asserts the same range.
   */
  it("stays inside the drawable frame for coordinates anywhere on Earth", () => {
    for (let lat = -85; lat <= 85; lat += 2.5) {
      for (let lng = -180; lng <= 180; lng += 5) {
        const { mapX, mapY } = toBrowsePosition({ lat, lng });
        expect(mapX).toBeGreaterThanOrEqual(6);
        expect(mapX).toBeLessThanOrEqual(94);
        expect(mapY).toBeGreaterThanOrEqual(8);
        expect(mapY).toBeLessThanOrEqual(92);
      }
    }
  });

  it("is deterministic, so a listing does not wander between renders", () => {
    const point = { lat: 37.5485, lng: -122.3122 };
    expect(toBrowsePosition(point)).toEqual(toBrowsePosition(point));
  });

  /**
   * The privacy property this function exists for. Two studios a few streets
   * apart share a position, so the picture cannot be read backwards into an
   * address — which is the whole reason Discover does not get a real map.
   */
  it("gives neighbours the same position", () => {
    const studio = { lat: 37.5485, lng: -122.3122 };
    const downTheRoad = { lat: 37.5487, lng: -122.3125 };

    expect(toBrowsePosition(downTheRoad)).toEqual(toBrowsePosition(studio));
  });

  it("separates places in different parts of a city", () => {
    const a = toBrowsePosition({ lat: 37.5485, lng: -122.3122 });
    const b = toBrowsePosition({ lat: 37.6104, lng: -122.3891 });

    expect(a).not.toEqual(b);
  });
});
