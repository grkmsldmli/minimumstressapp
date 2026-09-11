// @vitest-environment jsdom

/**
 * The four Discover header utilities are a compact 2×2 grid (opening to a row on
 * a wide screen), not a single cramped row. These pin the grid structure, that
 * the four actions still fire, and that the undelivered indicator survives — no
 * pixel assertions.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Discover } from "./discover";

beforeAll(() => {
  // The featured rail calls railRef.scrollTo in an effect; jsdom elements have
  // no scrollTo, so provide a no-op.
  if (!("scrollTo" in Element.prototype)) {
    (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  }
  // jsdom has neither IntersectionObserver (rail lazy-reveal) nor ResizeObserver
  // (the map view measures its container) — no-op stubs are enough here.
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", Obs);
  vi.stubGlobal("ResizeObserver", Obs);
});

afterEach(cleanup);

function renderDiscover(over: Partial<Parameters<typeof Discover>[0]> = {}) {
  const props = {
    spaces: [],
    isPro: false,
    onRefresh: vi.fn(),
    onOpenSpace: vi.fn(),
    onGoPro: vi.fn(),
    onGoBookings: vi.fn(),
    onGoWork: vi.fn(),
    onGoNotifications: vi.fn(),
    undeliveredCount: 0,
    onGoProfile: vi.fn(),
    onGoLegal: vi.fn(),
    greetingName: "Sam",
    you: null,
    rebookable: [],
    onRebook: vi.fn(),
    savedPostcode: null,
    onChangePostcode: vi.fn(),
    nearbyOrder: null,
    onChooseLocation: vi.fn(),
    distanceLabels: {},
    locationError: null,
    onRequestSpace: vi.fn(),
    ...over,
  };
  render(<Discover {...(props as Parameters<typeof Discover>[0])} />);
  return props;
}

describe("Discover header shortcuts", () => {
  it("lays the four utilities out as a responsive 2×2 grid", () => {
    renderDiscover();
    const grid = screen.getByRole("button", { name: "Work" }).parentElement;
    expect(grid?.className).toContain("grid");
    expect(grid?.className).toContain("grid-cols-2");
    // Widens to a single row on iPad.
    expect(grid?.className).toContain("sm:grid-cols-4");
    // All four utilities are present.
    expect(screen.getByRole("button", { name: "Work" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Your bookings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "What we've sent you" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show map" })).toBeTruthy();
  });

  it("keeps each action wired to its screen", () => {
    const props = renderDiscover();
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Your bookings" }));
    fireEvent.click(screen.getByRole("button", { name: "What we've sent you" }));
    expect(props.onGoWork).toHaveBeenCalledTimes(1);
    expect(props.onGoBookings).toHaveBeenCalledTimes(1);
    expect(props.onGoNotifications).toHaveBeenCalledTimes(1);
    // Map/List is a local toggle: its label flips after a tap.
    fireEvent.click(screen.getByRole("button", { name: "Show map" }));
    expect(screen.getByRole("button", { name: "Show list" })).toBeTruthy();
  });

  it("shows the undelivered dot only when something never arrived", () => {
    renderDiscover({ undeliveredCount: 0 });
    // The dot is a <span> inside the bell button; the icon itself is an <svg>.
    expect(
      screen.getByRole("button", { name: "What we've sent you" }).querySelector("span"),
    ).toBeNull();
    cleanup();
    renderDiscover({ undeliveredCount: 3 });
    expect(
      screen.getByRole("button", { name: "What we've sent you" }).querySelector("span"),
    ).not.toBeNull();
  });
});
