import { describe, expect, it } from "vitest";

import { adjacencyIsKnown, professionCovers } from "./modality-match";

describe("professionCovers", () => {
  it("a request with no profession is coverable by anyone", () => {
    expect(professionCovers(null, "pilates")).toBe(true);
    expect(professionCovers(undefined, "massage")).toBe(true);
    expect(professionCovers(null, null)).toBe(true);
  });

  it("a request needing a profession is not covered by a practitioner with none", () => {
    expect(professionCovers("pilates", null)).toBe(false);
  });

  it("an exact match always covers", () => {
    expect(professionCovers("massage", "massage")).toBe(true);
    expect(professionCovers("coaching", "coaching")).toBe(true);
  });

  it("movement disciplines overlap where it is genuinely true", () => {
    expect(professionCovers("movement", "pilates")).toBe(true);
    expect(professionCovers("movement", "yoga")).toBe(true);
    expect(professionCovers("pilates", "movement")).toBe(true);
    expect(professionCovers("yoga", "movement")).toBe(true);
  });

  it("does not let unrelated or licensed work cover a near-miss", () => {
    expect(professionCovers("pilates", "yoga")).toBe(false);
    expect(professionCovers("massage", "holistic")).toBe(false);
    expect(professionCovers("massage", "movement")).toBe(false);
    expect(professionCovers("meditation", "coaching")).toBe(false);
  });

  it("keeps the adjacency map pinned to real professions", () => {
    expect(adjacencyIsKnown()).toBe(true);
  });
});
