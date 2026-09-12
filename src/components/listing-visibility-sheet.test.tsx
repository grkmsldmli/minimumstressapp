// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListingVisibilitySheet } from "./listing-visibility-sheet";

const base = {
  open: true,
  spaceName: "Willow Studio",
  hidden: false,
  upcoming: 2,
  onClose: vi.fn(),
  onHide: vi.fn().mockResolvedValue(undefined),
  onReplace: vi.fn().mockResolvedValue(undefined),
  onShowAgain: vi.fn().mockResolvedValue(undefined),
  onRequestClosure: vi.fn().mockResolvedValue(undefined),
};

afterEach(cleanup);

describe("ListingVisibilitySheet", () => {
  it("separates a temporary hold, replacement and permanent closure", () => {
    render(<ListingVisibilitySheet {...base} />);

    expect(screen.getByRole("button", { name: /hide for now/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /replacing this listing/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /close this space permanently/i })).toBeTruthy();
  });

  it("collects a reason before sending a permanent closure request", async () => {
    const onRequestClosure = vi.fn().mockResolvedValue(undefined);
    render(<ListingVisibilitySheet {...base} onRequestClosure={onRequestClosure} />);

    fireEvent.click(screen.getByRole("button", { name: /close this space permanently/i }));
    fireEvent.click(screen.getByRole("radio", { name: /lease or right to use/i }));
    fireEvent.change(screen.getByPlaceholderText(/anything we should know/i), {
      target: { value: "Lease ends September 30" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm closure request/i }));

    await waitFor(() =>
      expect(onRequestClosure).toHaveBeenCalledWith("lease_ended", "Lease ends September 30"),
    );
  });

  it("shows an open request as waiting instead of offering relist", () => {
    render(
      <ListingVisibilitySheet
        {...base}
        hidden
        closureRequest={{
          id: "request-1",
          reason: "business_closed",
          detail: "Closing at the end of the month",
          state: "open",
          requestedAt: new Date("2026-09-12T00:00:00Z"),
        }}
      />,
    );

    expect(screen.getByText("Waiting for review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send back for review/i })).toBeNull();
  });
});
