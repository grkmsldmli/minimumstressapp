// @vitest-environment jsdom

/**
 * Changing what a room is good for, after it is already listed.
 *
 * The create form collects this and the edit screen did not, which is the
 * quiet half of the same bug: a host could set it once and never correct it,
 * and a room that stopped being used for pilates would sit on the pilates page
 * indefinitely with no way to say so.
 *
 * It is also the one field here that is not frozen by bookings. The address
 * and the room type are — somebody arranged their day around them — but nobody
 * booked an hour on the strength of a room being marked good for yoga.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { EditSpace } from "@/components/screens/edit-space";
import { MockRepository } from "@/lib/mock-repository";
import type { HostSpace } from "@/lib/domain";

beforeAll(() => {
  window.scrollTo = vi.fn();
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
});

afterEach(cleanup);

/**
 * A listing made the way a host makes one, so a change to the domain breaks
 * this at the type level rather than leaving it passing against a shape the
 * app no longer uses. The seeded rooms belong to other hosts; this one is
 * ours, which is what the edit screen is given.
 */
async function aSpace(suitableFor = ["pilates-studio"]): Promise<HostSpace> {
  const repo = new MockRepository();
  const [seed] = await repo.listPublicSpaces();

  return repo.createSpace({
    name: "Garden Room",
    category: "physical",
    roomSetup: "private_room",
    hourlyRateCents: 4500,
    capacity: 2,
    accessType: seed.accessType,
    entryInstructions: "Side gate.",
    addressLine: "12 Willow St, Redwood City, CA 94061",
    city: "Redwood City",
    state: "CA",
    postalCode: "94061",
    suitableFor,
    lat: 37.48,
    lng: -122.23,
    mapX: 0.5,
    mapY: 0.5,
    timeZone: "America/Los_Angeles",
    parking: seed.parking,
    floorAreaSqft: null,
    access: seed.access,
    restroom: seed.restroom,
    bufferMinutes: 0,
    amenities: [],
    requirements: [],
    houseRules: "",
    description: "A quiet room with a wooden floor and a door onto the garden.",
    media: [],
    availability: [],
    subleaseDoc: new File(["lease"], "lease.pdf", { type: "application/pdf" }),
    insuranceDoc: null,
  });
}

function open(space: HostSpace, bookedSessions = 0) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <EditSpace
      space={space}
      bookedSessions={bookedSessions}
      onSave={onSave}
      onAddMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
      onSetListed={vi.fn()}
      onEditHours={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  return { onSave };
}

/** Scoped, because four of these labels are also room type names. */
const use = (label: string) =>
  Array.from(
    screen.getByRole("group", { name: /Good for/i }).querySelectorAll("button"),
  ).find((button) => button.textContent?.trim() === label);

describe("editing what a room is good for", () => {
  it("shows what the listing is already marked for", async () => {
    const space = await aSpace(["pilates-studio", "yoga-studio"]);
    // Two, so this is asserting against a listing that really carries them
    // rather than an empty case that would pass either way.
    expect(space.suitableFor).toEqual(["pilates-studio", "yoga-studio"]);

    open(space);
    for (const slug of space.suitableFor) {
      const marked = Array.from(
        screen.getByRole("group", { name: /Good for/i }).querySelectorAll("button"),
      ).filter((b) => b.getAttribute("aria-pressed") === "true");
      expect(marked.length, slug).toBeGreaterThan(0);
    }
  });

  /*
   * The lock covers the address and the room type. It must not cover this, or
   * a busy host — the only kind who has bookings — is the one who cannot
   * correct it.
   */
  it("stays editable while sessions are booked", async () => {
    const space = await aSpace();
    open(space, 3);

    expect(screen.getByText(/Address and room type are locked/i)).toBeDefined();
    expect(screen.getByRole("group", { name: /Good for/i })).toBeDefined();
  });

  it("sends the change when it is saved", async () => {
    const space = await aSpace();
    const { onSave } = open(space);

    const yoga = use("Yoga Studio")!;
    const wasOn = yoga.getAttribute("aria-pressed") === "true";
    fireEvent.click(yoga);

    fireEvent.click(screen.getByRole("button", { name: /^Save changes$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [edit] = onSave.mock.calls[0] as [{ suitableFor?: string[] }];
    expect(edit.suitableFor).toBeDefined();
    expect(edit.suitableFor!.includes("yoga-studio")).toBe(!wasOn);
  });

  /**
   * The town is not sent unless a new address was actually resolved.
   *
   * This is the one that would be invisible. Sending it whenever the point
   * moves means a host nudging the pin onto the right door writes a null town
   * over a good one, and the listing drops off its city page for a correction
   * to a doorway.
   */
  it("does not touch the town when nothing about the address changed", async () => {
    const space = await aSpace();
    const { onSave } = open(space);

    fireEvent.click(use("Yoga Studio")!);
    fireEvent.click(screen.getByRole("button", { name: /^Save changes$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [edit] = onSave.mock.calls[0] as [Record<string, unknown>];

    // Absent, not null. `undefined` is what tells the repository to leave the
    // stored value alone; null would erase it.
    expect("city" in edit).toBe(false);
    expect("state" in edit).toBe(false);
    expect("postalCode" in edit).toBe(false);
  });
});
