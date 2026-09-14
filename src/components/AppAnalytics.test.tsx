// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  platform: vi.fn(() => "ios" as const),
  opened: vi.fn(async () => true),
}));
vi.mock("@/lib/analytics/client", () => ({
  appAnalyticsPlatform: analytics.platform,
  captureAppOpened: analytics.opened,
}));

import { AppAnalytics } from "./AppAnalytics";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AppAnalytics", () => {
  it("records one app launch without receiving or exposing screen state", () => {
    const view = render(<AppAnalytics />);
    expect(analytics.opened).toHaveBeenCalledWith("ios");

    view.rerender(<AppAnalytics />);
    expect(analytics.opened).toHaveBeenCalledTimes(1);
  });
});
