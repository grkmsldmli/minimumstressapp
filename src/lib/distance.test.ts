import { describe, expect, it } from "vitest";

import {
  distanceBetween,
  distanceLabel,
  isPostalCode,
  normalisePostalCode,
  sortByDistance,
} from "./distance";

/** Real places, so the arithmetic is checked against the world. */
const SAN_MATEO = { lat: 37.5327, lng: -122.327 };
const SAN_FRANCISCO = { lat: 37.7883, lng: -122.4075 };
const CUPERTINO = { lat: 37.3318, lng: -122.0312 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };

describe("distanceBetween", () => {
  it("measures a route somebody could actually drive", () => {
    // San Mateo to San Francisco is about 18 miles as the crow flies.
    expect(distanceBetween(SAN_MATEO, SAN_FRANCISCO)).toBeCloseTo(18, 0);
  });

  it("measures a continental one", () => {
    // San Francisco to New York, roughly 2,570 miles.
    expect(distanceBetween(SAN_FRANCISCO, NEW_YORK)).toBeGreaterThan(2500);
    expect(distanceBetween(SAN_FRANCISCO, NEW_YORK)).toBeLessThan(2620);
  });

  it("reports zero for the same point", () => {
    expect(distanceBetween(SAN_MATEO, SAN_MATEO)).toBe(0);
  });

  it("is symmetric", () => {
    expect(distanceBetween(SAN_MATEO, CUPERTINO)).toBeCloseTo(
      distanceBetween(CUPERTINO, SAN_MATEO),
      10,
    );
  });

  it("answers in kilometres when asked", () => {
    const miles = distanceBetween(SAN_MATEO, SAN_FRANCISCO, "mi");
    const km = distanceBetween(SAN_MATEO, SAN_FRANCISCO, "km");
    expect(km / miles).toBeCloseTo(1.609, 2);
  });

  /** Antipodal points: the case where a careless sqrt goes NaN. */
  it("survives opposite sides of the planet", () => {
    const d = distanceBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(12437, -1);
  });
});

describe("distanceLabel", () => {
  /**
   * The privacy rule, not a formatting preference. Three precise distances
   * from three known points place a room exactly; a coarse label does not.
   */
  it("refuses to be precise at close range", () => {
    expect(distanceLabel(0.02)).toBe("Nearby");
    expect(distanceLabel(0.099)).toBe("Nearby");
  });

  it("gives one decimal within walking and driving range", () => {
    expect(distanceLabel(0.83)).toBe("0.8 mi");
    expect(distanceLabel(9.94)).toBe("9.9 mi");
  });

  it("drops the decimal further out, where it means nothing", () => {
    expect(distanceLabel(23.4)).toBe("23 mi");
  });

  it("stops counting past a hundred", () => {
    expect(distanceLabel(342)).toBe("340+ mi");
  });

  it("carries the unit it was given", () => {
    expect(distanceLabel(4.2, "km")).toBe("4.2 km");
  });
});

describe("sortByDistance", () => {
  const spaces = [
    { id: "sf", ...SAN_FRANCISCO },
    { id: "cupertino", ...CUPERTINO },
    { id: "sanmateo", ...SAN_MATEO },
  ];

  it("puts the closest first", () => {
    const ordered = sortByDistance(spaces, SAN_MATEO);
    expect(ordered.map((r) => r.item.id)).toEqual(["sanmateo", "sf", "cupertino"]);
  });

  it("labels each one", () => {
    const ordered = sortByDistance(spaces, SAN_MATEO);
    expect(ordered[0].label).toBe("Nearby");
    // Eighteen miles, so past the point where a decimal tells anyone anything.
    expect(ordered[1].label).toBe("18 mi");
  });

  /**
   * Older rows predate geocoding. Vanishing from search is a worse failure
   * than appearing without a distance — but "we do not know" must not outrank
   * "half a mile away".
   */
  it("keeps a listing with no coordinates, and puts it last", () => {
    const ordered = sortByDistance(
      [{ id: "unknown", lat: null, lng: null }, ...spaces],
      SAN_MATEO,
    );
    expect(ordered.at(-1)!.item.id).toBe("unknown");
    expect(ordered.at(-1)!.label).toBe("Distance unknown");
    expect(ordered).toHaveLength(4);
  });

  it("handles a list of nothing but unknowns", () => {
    const ordered = sortByDistance(
      [{ id: "a", lat: null, lng: null }, { id: "b", lat: null, lng: null }],
      SAN_MATEO,
    );
    expect(ordered.map((r) => r.item.id)).toEqual(["a", "b"]);
  });

  it("returns an empty list unchanged", () => {
    expect(sortByDistance([], SAN_MATEO)).toEqual([]);
  });
});

describe("postal codes", () => {
  it.each(["94403", "94403-1234"])("accepts %s", (code) => {
    expect(isPostalCode(code)).toBe(true);
  });

  it.each(["9440", "944030", "ABCDE", "94403-12", "", "94403 "])(
    "rejects %s",
    (code) => {
      // Trailing space is trimmed first, so that one is genuinely valid.
      expect(isPostalCode(code)).toBe(code.trim() === "94403");
    },
  );

  it("reduces either form to the five digits a geocoder wants", () => {
    expect(normalisePostalCode("94403-1234")).toBe("94403");
    expect(normalisePostalCode("  94403  ")).toBe("94403");
  });
});
