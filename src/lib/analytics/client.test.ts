// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isNativeApp } = vi.hoisted(() => ({ isNativeApp: vi.fn(() => false) }));
vi.mock("@/lib/native", () => ({ isNativeApp }));

import {
  analyticsSessionId,
  appAnalyticsPlatform,
  captureAnalytics,
  captureAppOpened,
  websiteSurface,
} from "./client";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  isNativeApp.mockReset();
  isNativeApp.mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
});

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the analytics session", () => {
  it("uses one opaque id for the tab and never persists one in localStorage", () => {
    const first = analyticsSessionId();
    const second = analyticsSessionId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second).toBe(first);
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it("sends only the fixed event envelope and omits credentials", async () => {
    await captureAnalytics({
      event: "page_viewed",
      platform: "site_web",
      surface: "/about",
      // TypeScript callers cannot add this; keeping the runtime boundary exact
      // protects against a future untyped caller as well.
      userId: "somebody-else",
    } as never);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/analytics");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({
      event: "page_viewed",
      platform: "site_web",
      surface: "/about",
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
  });

  it("fails closed when sessionStorage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(await captureAnalytics({ event: "page_viewed", platform: "site_web", surface: "/" })).toBe(
      false,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records one app open across repeated screen effects", async () => {
    const first = await captureAppOpened("ios");
    const second = await captureAppOpened("ios");

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({ event: "app_opened", platform: "ios", surface: "app" }),
    );
    expect(sessionStorage.getItem("minimumstress.analytics.app-opened.ios")).toBe(
      analyticsSessionId(),
    );
  });
});

describe("website surfaces", () => {
  it("keeps static routes and removes the internal rewrite prefix", () => {
    expect(websiteSurface("/about")).toBe("/about");
    expect(websiteSurface("/site/faq/")).toBe("/faq");
  });

  it("sends route templates, never dynamic values or query text", () => {
    expect(websiteSurface("/spaces/ca/san-francisco/treatment?near=home")).toBe(
      "/spaces/[state]/[city]/[type]",
    );
    expect(websiteSurface("/assessments/burnout-test?email=private@example.com")).toBe(
      "/assessments/[assessment]",
    );
  });

  it("refuses admin, unknown and id-bearing routes", () => {
    expect(websiteSurface("/admin/system")).toBeNull();
    expect(websiteSurface("/bookings/64db400b-1ac9-41b8-a617-0984a8e2597b")).toBeNull();
    expect(websiteSurface("/something-added-without-review")).toBeNull();
  });
});

describe("app platform", () => {
  it("distinguishes the web app from native OS builds without sending device detail", () => {
    expect(appAnalyticsPlatform()).toBe("app_web");

    isNativeApp.mockReturnValue(true);
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "ios" };
    expect(appAnalyticsPlatform()).toBe("ios");

    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "android" };
    expect(appAnalyticsPlatform()).toBe("android");
  });
});
