// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { isNativeApp, openExternal } from "./native";

/**
 * Leaving the app for a Stripe-hosted or legal page. On the web it navigates; in
 * the native shell it must hand off to the system browser, never the WebView — an
 * embedded purchase webview is what App Store 3.1.1 forbids.
 */

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
});

describe("isNativeApp", () => {
  it("is false in an ordinary browser", () => {
    expect(isNativeApp()).toBe(false);
  });

  it("is true when the Capacitor shell has injected its global", () => {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(isNativeApp()).toBe(true);
  });
});

describe("openExternal", () => {
  it("navigates the page on the web", () => {
    // jsdom throws on real navigation; spy on the assignment instead.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const setter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { set href(v: string) { setter(v); } },
    });

    openExternal("https://checkout.stripe.com/pay/abc");

    expect(setter).toHaveBeenCalledWith("https://checkout.stripe.com/pay/abc");
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the system browser in the native shell", () => {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    openExternal("https://checkout.stripe.com/pay/abc");

    expect(open).toHaveBeenCalledWith("https://checkout.stripe.com/pay/abc", "_blank");
  });
});
