import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Discover cards must never download the detail/original image into a 145px card
 * (0066). The card cover uses the card thumbnail variant and defers loading;
 * this guards the source so a refactor cannot quietly point a card back at the
 * full-size `cover.url`.
 */
describe("Discover card media", () => {
  const source = readFileSync(join(import.meta.dirname, "discover.tsx"), "utf8");

  it("uses the card thumbnail variant for card covers, never the detail url", () => {
    expect(source).toMatch(/src=\{cover\.cardUrl\}/);
    expect(source).not.toMatch(/src=\{cover\.url\}/);
  });

  it("hints the browser to defer card images", () => {
    expect(source).toMatch(/loading=/);
    expect(source).toMatch(/decoding="async"/);
  });
});
