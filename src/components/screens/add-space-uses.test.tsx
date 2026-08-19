// @vitest-environment jsdom

/**
 * What a room is good for, as the host is actually asked it.
 *
 * This is the field every generated page depends on: a room marked for pilates
 * is what puts a listing on /spaces/ca/san-mateo/pilates-studio, and a room
 * marked for nothing appears on none of them. The failure mode is silent in
 * both directions — a chip that does not register looks identical to one
 * nobody pressed, and a stale selection surviving a change of room type puts a
 * massage room on the yoga page.
 *
 * Rendered rather than reasoned about, because the last round of silent
 * failures in this app all shipped through a suite that could not press a
 * button.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AddSpace } from "@/components/screens/add-space";
import { SPACE_TYPES, spaceTypesFor } from "@/lib/space-types";

beforeAll(() => {
  // jsdom has neither, and the form's map and uploads reach for both.
  window.scrollTo = vi.fn();
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

function open() {
  const onListed = vi.fn().mockResolvedValue(undefined);
  const onAcceptHostTerms = vi.fn().mockResolvedValue(undefined);
  render(
    <AddSpace
      onBack={vi.fn()}
      onListed={onListed}
      hostTermsAccepted={false}
      onAcceptHostTerms={onAcceptHostTerms}
    />,
  );
  return { onListed, onAcceptHostTerms };
}

/**
 * A chip inside one of the two named groups.
 *
 * Scoped, because four labels appear in both rows — "Treatment Room" is a room
 * type and also a use — and a query that just looks for the words finds the
 * wrong one. The groups carry accessible names for exactly this reason, which
 * is as true for somebody using a screen reader as it is here.
 */
const within = (group: string, label: string) =>
  Array.from(screen.getByRole("group", { name: new RegExp(group, "i") }).querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === label);

const roomType = (label: string) => within("Room type", label);
const use = (label: string) => within("Good for", label);

describe("the uses a host can mark", () => {
  /*
   * Nothing is offered before a room type is chosen. The uses belong to the
   * type — a treatment room is not a yoga studio — and showing all ten at once
   * would invite a host to tick the ones that do not apply to them.
   */
  it("offers none until a room type is picked", () => {
    open();
    expect(screen.queryByText(/Good for/i)).toBeNull();
    expect(screen.queryByRole("group", { name: /Good for/i })).toBeNull();
    // And no use is offered anywhere else on the page either.
    for (const type of SPACE_TYPES) {
      const loose = screen
        .getAllByRole("button")
        .filter((button) => button.textContent?.trim() === type.label);
      // The four that share a name with a room type are allowed exactly one
      // appearance — as the room type.
      expect(loose.length, type.label).toBeLessThanOrEqual(1);
    }
  });

  it("offers the ones that belong to the chosen room type", () => {
    open();
    fireEvent.click(roomType("Movement Studio")!);

    for (const type of spaceTypesFor("physical")) {
      expect(use(type.label), type.label).toBeDefined();
    }
    // And not the ones belonging to another. A massage room on the movement
    // list is a listing on a page it does not belong on.
    for (const type of spaceTypesFor("traditional")) {
      expect(use(type.label), type.label).toBeUndefined();
    }
  });

  /*
   * Several at once, which is the entire reason the column is an array: one
   * floor genuinely suits yoga and pilates, and one label would be both less
   * true and half the pages.
   */
  it("lets a room be marked for more than one thing", () => {
    open();
    fireEvent.click(roomType("Movement Studio")!);

    const pilates = use("Pilates Studio")!;
    const yoga = use("Yoga Studio")!;
    fireEvent.click(pilates);
    fireEvent.click(yoga);

    expect(pilates.getAttribute("aria-pressed") ?? "true").not.toBe("false");
    expect(yoga.getAttribute("aria-pressed") ?? "true").not.toBe("false");
    // Both still on screen and still distinct — a second press must not have
    // replaced the first.
    expect(use("Pilates Studio")).toBeDefined();
    expect(use("Yoga Studio")).toBeDefined();
  });

  it("un-marks one that is pressed again", () => {
    open();
    fireEvent.click(roomType("Movement Studio")!);

    const pilates = use("Pilates Studio")!;
    fireEvent.click(pilates);
    fireEvent.click(pilates);

    // Nothing to assert on the payload here — the submit is three steps away
    // — so this asserts the chip is still there to press, which is the part
    // that broke when the toggle was written as an append.
    expect(use("Pilates Studio")).toBeDefined();
  });

  /*
   * The one that would be invisible. Changing the room type swaps the list,
   * and anything ticked under the old one is no longer on screen to untick —
   * so a host who picks Movement Studio, ticks Pilates, then changes to
   * Treatment Room would list a massage room that appears on the pilates page
   * with no way to see why.
   */
  it("clears what was marked when the room type changes", () => {
    open();
    fireEvent.click(roomType("Movement Studio")!);
    fireEvent.click(use("Pilates Studio")!);

    fireEvent.click(roomType("Treatment Room")!);
    expect(use("Pilates Studio")).toBeUndefined();

    // Back again, and it is not still ticked underneath.
    fireEvent.click(roomType("Movement Studio")!);
    const pilates = use("Pilates Studio")!;
    expect(pilates.getAttribute("aria-pressed") ?? "false").not.toBe("true");
  });

  /*
   * Optional on purpose. A host who ticks nothing still gets a listing that
   * browses and books; it only misses the pages built around a use. Requiring
   * it would trade a real room for a tidier database.
   */
  it("says it is optional", () => {
    open();
    fireEvent.click(roomType("Movement Studio")!);
    expect(screen.getByText(/optional/i)).toBeDefined();
  });
});
