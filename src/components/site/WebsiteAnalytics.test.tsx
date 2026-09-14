// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/", capture: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/lib/analytics/client", async (load) => {
  const actual = await load<typeof import("@/lib/analytics/client")>();
  return { ...actual, captureAnalytics: state.capture };
});

import { WebsiteAnalytics } from "./WebsiteAnalytics";

beforeEach(() => {
  state.pathname = "/";
  state.capture.mockReset();
  state.capture.mockResolvedValue(true);
});

afterEach(cleanup);

describe("WebsiteAnalytics", () => {
  it("counts a public page with its bounded route name", () => {
    state.pathname = "/spaces/ca/oakland/treatment-room";
    render(<WebsiteAnalytics />);

    expect(state.capture).toHaveBeenCalledWith({
      event: "page_viewed",
      platform: "site_web",
      surface: "/spaces/[state]/[city]/[type]",
    });
  });

  it("does not report an admin or unknown route", () => {
    state.pathname = "/admin/people/some-id";
    const view = render(<WebsiteAnalytics />);
    expect(state.capture).not.toHaveBeenCalled();

    state.pathname = "/private/some-id";
    view.rerender(<WebsiteAnalytics />);
    expect(state.capture).not.toHaveBeenCalled();
  });
});
