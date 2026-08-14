import { describe, expect, it } from "vitest";

import { TILE_ORIGIN, TILE_TEMPLATE, tileUrl } from "./map-tiles";

/**
 * Where the map's pictures come from.
 *
 * The origin is derived from the template rather than configured beside it,
 * because two variables that must agree are two variables that will not — and
 * the failure is a blank map with a console message nobody is watching for.
 */
describe("tile addresses", () => {
  it("fills in the tile coordinates", () => {
    expect(tileUrl(14, 2624, 6346)).toContain("14");
    expect(tileUrl(14, 2624, 6346)).toContain("2624");
    expect(tileUrl(14, 2624, 6346)).toContain("6346");
    expect(tileUrl(14, 2624, 6346)).not.toContain("{z}");
    expect(tileUrl(14, 2624, 6346)).not.toContain("{x}");
    expect(tileUrl(14, 2624, 6346)).not.toContain("{y}");
  });

  it("puts them in the order the template asks for", () => {
    const url = tileUrl(1, 2, 3);
    expect(url.indexOf("/1/")).toBeLessThan(url.indexOf("/2/"));
    expect(url.indexOf("/2/")).toBeLessThan(url.indexOf("/3"));
  });

  it("keeps whatever the provider needs after the path", () => {
    // A key rides in the query string, which is why this is a whole URL rather
    // than a host — dropping it would serve blank tiles on every screen.
    const query = TILE_TEMPLATE.includes("?") ? TILE_TEMPLATE.split("?")[1] : "";
    if (query) expect(tileUrl(9, 8, 7)).toContain(query);
  });

  it("derives an origin the policy can allow", () => {
    expect(TILE_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
    expect(tileUrl(1, 1, 1).startsWith(TILE_ORIGIN)).toBe(true);
  });
});
