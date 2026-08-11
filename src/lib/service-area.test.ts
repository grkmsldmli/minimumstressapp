import { describe, expect, it } from "vitest";

import { isInServiceArea, milesOutside } from "./service-area";

const at = (lat: number, lng: number) => ({ lat, lng });

/** Real places, because the boundary is only meaningful against real ones. */
const SAN_FRANCISCO = at(37.7749, -122.4194);
const OAKLAND = at(37.8044, -122.2712);
const BERKELEY = at(37.8715, -122.273);
const SAN_JOSE = at(37.3382, -121.8863);
const FOSTER_CITY = at(37.5585, -122.2711);
const REDWOOD_CITY = at(37.4852, -122.2364);

const SANTA_CRUZ = at(36.9741, -122.0308);
const SANTA_ROSA = at(38.4404, -122.7141);
const SACRAMENTO = at(38.5816, -121.4944);
const LOS_ANGELES = at(34.0522, -118.2437);
const COLUMBUS = at(39.9612, -82.9988);

describe("where we launched", () => {
  it("covers the cities the first studios are actually in", () => {
    for (const place of [
      SAN_FRANCISCO,
      OAKLAND,
      BERKELEY,
      SAN_JOSE,
      FOSTER_CITY,
      REDWOOD_CITY,
    ]) {
      expect(isInServiceArea(place)).toBe(true);
    }
  });

  /**
   * These are the ones worth naming. Each is somewhere a person would
   * reasonably call the Bay Area or near enough to argue about, and each is
   * far enough that a practitioner would not drive it for one hour of work.
   */
  it("stops at the edge of a drive somebody would make", () => {
    for (const place of [SANTA_CRUZ, SANTA_ROSA, SACRAMENTO]) {
      expect(isInServiceArea(place)).toBe(false);
    }
  });

  it("is nowhere near the rest of the country", () => {
    expect(isInServiceArea(LOS_ANGELES)).toBe(false);
    expect(isInServiceArea(COLUMBUS)).toBe(false);
  });
});

describe("saying how far outside", () => {
  it("is zero inside, so the caller can use it as the whole test", () => {
    expect(milesOutside(SAN_FRANCISCO)).toBe(0);
    expect(milesOutside(SAN_JOSE)).toBe(0);
  });

  /**
   * The number is the point. "Not available in your area" reads like a bug to
   * somebody in Santa Cruz whose neighbour up the coast is listed; "about
   * three miles outside" is a fact they can weigh.
   */
  it("is small and honest just past the line", () => {
    const over = milesOutside(SANTA_CRUZ);
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(10);
  });

  it("grows with the distance rather than saturating", () => {
    expect(milesOutside(SACRAMENTO)).toBeGreaterThan(milesOutside(SANTA_CRUZ));
    expect(milesOutside(LOS_ANGELES)).toBeGreaterThan(milesOutside(SACRAMENTO));
  });

  /** Never rounds down to nothing, which would read as "you are inside". */
  it("never reports zero for a place that is outside", () => {
    for (const place of [SANTA_CRUZ, SANTA_ROSA, SACRAMENTO, LOS_ANGELES, COLUMBUS]) {
      expect(milesOutside(place)).toBeGreaterThanOrEqual(1);
    }
  });
});
