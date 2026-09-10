// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SpaceGallery } from "@/components/space-gallery";
import type { SpaceMedia } from "@/lib/domain";

// jsdom has no IntersectionObserver; the gallery uses one to track the visible
// frame. A no-op stub is enough — the dots aren't what these tests assert.
beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
});

/**
 * Space Detail's gallery shows the detail variant (0066), not the card
 * thumbnail, and only the frame on screen loads eagerly — the rest wait until
 * they are swiped to.
 */

afterEach(cleanup);

const media: SpaceMedia[] = [
  { id: "a", url: "https://cdn.example/detail-a", cardUrl: "https://cdn.example/card-a", kind: "image" },
  { id: "b", url: "https://cdn.example/detail-b", cardUrl: "https://cdn.example/card-b", kind: "image" },
];

describe("SpaceGallery", () => {
  it("renders the detail variant, never the card thumbnail", () => {
    const { container } = render(<SpaceGallery media={media} category="physical" height={320} />);
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toEqual(["https://cdn.example/detail-a", "https://cdn.example/detail-b"]);
    expect(container.innerHTML).not.toContain("card-a");
  });

  it("loads the first frame eagerly and defers the rest", () => {
    const { container } = render(<SpaceGallery media={media} category="physical" height={320} />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs[0].getAttribute("loading")).toBe("eager");
    expect(imgs[0].getAttribute("decoding")).toBe("async");
    expect(imgs[1].getAttribute("loading")).toBe("lazy");
  });
});
