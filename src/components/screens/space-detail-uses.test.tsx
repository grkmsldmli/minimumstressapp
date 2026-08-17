// @vitest-environment jsdom

/**
 * What the listing says the room is good for.
 *
 * The host is told, while marking these, that "this is how people find you" —
 * and until now the listing never showed them back. A field somebody fills in
 * and never sees again is a field they stop filling in, and this one decides
 * which pages the room appears on, so it is the last one that should be
 * allowed to rot.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SpaceDetail } from "@/components/screens/space-detail";
import { MockRepository } from "@/lib/mock-repository";
import type { PublicSpace } from "@/lib/domain";

beforeAll(() => {
  window.scrollTo = vi.fn();
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
});

afterEach(cleanup);

async function seeded(): Promise<PublicSpace> {
  const [first] = await new MockRepository().listPublicSpaces();
  return first;
}

function show(space: PublicSpace) {
  render(
    <SpaceDetail
      space={space}
      isPro={false}
      reviews={[]}
      onBack={vi.fn()}
      onBook={vi.fn()}
      onGoPro={vi.fn()}
    />,
  );
}

describe("the uses on a listing", () => {
  it("names each one in words, not slugs", async () => {
    const space = await seeded();
    // The seeded reformer studio is marked for two things, so this is a real
    // case rather than one that would pass on an empty array.
    expect(space.suitableFor).toEqual(["pilates-studio", "movement-studio"]);

    show(space);

    expect(screen.getByText("Good for")).toBeDefined();
    expect(screen.getByText("Pilates Studio")).toBeDefined();
    // And not the stored form, which is a URL segment and not English.
    expect(screen.queryByText("pilates-studio")).toBeNull();
  });

  /*
   * The badge at the top of the page already says "Movement Studio". Saying it
   * again under "Good for" is the listing repeating itself in the one place a
   * reader is scanning for something new.
   */
  it("does not repeat the room type it already shows", async () => {
    const space = await seeded();
    show(space);

    // Once — as the badge, not twice.
    expect(screen.getAllByText("Movement Studio")).toHaveLength(1);
  });

  /*
   * And a room marked only for what it already is has nothing extra to say,
   * so the heading does not appear at all.
   */
  it("shows no heading when every use is the room type itself", async () => {
    show({ ...(await seeded()), suitableFor: ["movement-studio"] });
    expect(screen.queryByText("Good for")).toBeNull();
  });

  /*
   * A room the host has not marked shows no heading at all, rather than an
   * empty one. Optional means optional.
   */
  it("shows nothing when the host marked nothing", async () => {
    show({ ...(await seeded()), suitableFor: [] });
    expect(screen.queryByText("Good for")).toBeNull();
  });

  /*
   * A use retired since the listing was saved is skipped rather than printed
   * raw. The column is filtered on the way in, so this is the belt to that
   * pair of braces — and the failure it prevents is a listing showing
   * "reiki-room" to a stranger.
   */
  it("skips a use it no longer recognises", async () => {
    show({ ...(await seeded()), suitableFor: ["pilates-studio", "retired-thing"] });

    expect(screen.getByText("Pilates Studio")).toBeDefined();
    expect(screen.queryByText("retired-thing")).toBeNull();
  });
});
