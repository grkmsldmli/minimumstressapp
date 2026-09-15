// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { nativePushConsentGiven, setNativePushConsentGiven } from "./consent";

beforeEach(() => window.localStorage.clear());

describe("native push consent", () => {
  it("fails closed until the user opt-in is recorded", () => {
    expect(nativePushConsentGiven()).toBe(false);
    setNativePushConsentGiven(true);
    expect(nativePushConsentGiven()).toBe(true);
    setNativePushConsentGiven(false);
    expect(nativePushConsentGiven()).toBe(false);
  });

  it("fails closed when WebView storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(nativePushConsentGiven()).toBe(false);
  });
});
