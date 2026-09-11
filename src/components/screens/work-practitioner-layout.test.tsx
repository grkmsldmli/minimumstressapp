// @vitest-environment jsdom

/**
 * The practitioner Work top is a balanced action grid, not stacked rows. These
 * pin the four tiles and their actions — no pixel assertions, just that the grid
 * exists and its controls are wired. Entitlement/functionality are unchanged.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkPreferences } from "@/lib/domain";
import { WorkPractitioner } from "./work";

afterEach(cleanup);

const PREFS: WorkPreferences = {
  availableForWork: false,
  workTimeZone: "America/Los_Angeles",
  hasLocation: false,
  basePostcode: null,
  maxTravelMiles: null,
  minPayCents: null,
  openToOnetime: true,
  openToRecurring: false,
};

function renderWork(over: Partial<Parameters<typeof WorkPractitioner>[0]> = {}) {
  const props = {
    canBrowse: true,
    canApply: true,
    practitionerProActive: true,
    foundingProFreeUntil: null,
    now: new Date("2026-09-11T00:00:00Z"),
    gaps: [],
    preferences: PREFS,
    availabilityCount: 3,
    opportunities: [],
    busyRequestId: null,
    onToggleAvailable: vi.fn(),
    onEditAvailability: vi.fn(),
    onExpressInterest: vi.fn(),
    onWithdrawInterest: vi.fn(),
    onFixGap: vi.fn(),
    onGoPro: vi.fn(),
    onRefresh: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
  render(<WorkPractitioner {...props} />);
  return props;
}

describe("WorkPractitioner — action grid", () => {
  it("shows the four action tiles", () => {
    renderWork();
    expect(screen.getByText("Available for work")).toBeTruthy();
    expect(screen.getByText("Weekly hours")).toBeTruthy();
    expect(screen.getByText("My applications")).toBeTruthy();
    // "Coverage board" is both the tile label and the section heading below it.
    expect(screen.getAllByText("Coverage board").length).toBeGreaterThanOrEqual(1);
  });

  it("the Available tile reflects state and toggles it", () => {
    const props = renderWork({ preferences: { ...PREFS, availableForWork: false } });
    expect(screen.getByText("Off")).toBeTruthy();
    fireEvent.click(screen.getByText("Available for work"));
    expect(props.onToggleAvailable).toHaveBeenCalledTimes(1);
  });

  it("the Weekly hours tile shows the count and opens the editor", () => {
    const props = renderWork({ availabilityCount: 3 });
    expect(screen.getByText("3 set")).toBeTruthy();
    fireEvent.click(screen.getByText("Weekly hours"));
    expect(props.onEditAvailability).toHaveBeenCalledTimes(1);
  });

  it("the Coverage board tile reads 'Pro' when browsing is locked", () => {
    renderWork({ canBrowse: false });
    expect(screen.getByText("Pro")).toBeTruthy();
  });

  it("the 'My applications' tile is a static (non-pressable) tile when there are none", () => {
    renderWork({ opportunities: [] });
    // No section to jump to, so it must not be a dead pressable button.
    expect(screen.getByText("My applications").closest("button")).toBeNull();
  });
});
