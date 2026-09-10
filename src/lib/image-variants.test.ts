import { describe, expect, it } from "vitest";

import { IMAGE_VARIANTS, fitWithin } from "./image-variants";

/**
 * The dimension maths behind the upload variants. The canvas encoding needs a
 * browser and is exercised through the repository; this pins the part that
 * decides how big each variant is — which is where "download the whole 12 MB
 * original into a thumbnail" would sneak back in.
 */
describe("fitWithin", () => {
  it("scales a large landscape photo down to the long edge", () => {
    expect(fitWithin(4000, 3000, 600)).toEqual({ width: 600, height: 450 });
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a large portrait photo by its long (vertical) edge", () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("never upscales a photo already within the limit", () => {
    expect(fitWithin(400, 300, 600)).toEqual({ width: 400, height: 300 });
    expect(fitWithin(600, 400, 600)).toEqual({ width: 600, height: 400 });
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("keeps the long edge at or under the limit for any shape", () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
      [5000, 5000],
      [8000, 1000],
      [640, 480],
    ]) {
      for (const maxEdge of [600, 1600]) {
        const out = fitWithin(w, h, maxEdge);
        expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(maxEdge);
      }
    }
  });
});

describe("IMAGE_VARIANTS", () => {
  it("is a 600px card and a 1600px detail", () => {
    const byLabel = Object.fromEntries(IMAGE_VARIANTS.map((v) => [v.label, v]));
    expect(byLabel.card.maxEdge).toBe(600);
    expect(byLabel.detail.maxEdge).toBe(1600);
    for (const variant of IMAGE_VARIANTS) {
      expect(variant.quality).toBeGreaterThan(0.5);
      expect(variant.quality).toBeLessThanOrEqual(0.85);
    }
  });
});
