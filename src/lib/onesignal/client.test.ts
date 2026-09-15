import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativeApp: vi.fn(),
  setConsentRequired: vi.fn(),
  setConsentGiven: vi.fn(),
  initialize: vi.fn(),
}));

vi.mock("@/lib/native", () => ({ isNativeApp: mocks.isNativeApp }));
vi.mock("@/lib/onesignal/config", () => ({
  publicOneSignalAppId: () => "native-app-id",
}));
vi.mock("@onesignal/capacitor-plugin", () => ({
  default: {
    setConsentRequired: mocks.setConsentRequired,
    setConsentGiven: mocks.setConsentGiven,
    initialize: mocks.initialize,
  },
}));

import { nativeOneSignal } from "./client";

beforeEach(() => {
  mocks.isNativeApp.mockReturnValue(true);
  mocks.initialize.mockResolvedValue(undefined);
});

describe("nativeOneSignal", () => {
  it("re-gates persisted consent before initializing the SDK", async () => {
    await nativeOneSignal();

    expect(mocks.setConsentRequired).toHaveBeenCalledWith(true);
    expect(mocks.setConsentGiven).toHaveBeenCalledWith(false);
    expect(mocks.initialize).toHaveBeenCalledWith("native-app-id");
    expect(mocks.setConsentRequired.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setConsentGiven.mock.invocationCallOrder[0]);
    expect(mocks.setConsentGiven.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.initialize.mock.invocationCallOrder[0]);
  });
});
