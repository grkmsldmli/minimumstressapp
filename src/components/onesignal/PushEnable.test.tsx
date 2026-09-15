// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativeApp: vi.fn(),
  currentPushIdentity: vi.fn(),
  nativeOneSignal: vi.fn(),
  nativePushConsentGiven: vi.fn(),
  setNativePushConsentGiven: vi.fn(),
  requestNativePushOptIn: vi.fn(),
  requestWebPushOptIn: vi.fn(),
  webOneSignal: vi.fn(),
}));

vi.mock("@/lib/native", () => ({ isNativeApp: mocks.isNativeApp }));
vi.mock("@/lib/onesignal/client", () => ({
  currentPushIdentity: mocks.currentPushIdentity,
  nativeOneSignal: mocks.nativeOneSignal,
}));
vi.mock("@/lib/onesignal/web", () => ({ webOneSignal: mocks.webOneSignal }));
vi.mock("@/lib/onesignal/consent", () => ({
  nativePushConsentGiven: mocks.nativePushConsentGiven,
  setNativePushConsentGiven: mocks.setNativePushConsentGiven,
}));
vi.mock("@/lib/onesignal/native-sync", () => ({
  requestNativePushOptIn: mocks.requestNativePushOptIn,
}));
vi.mock("@/lib/onesignal/web-sync", () => ({
  requestWebPushOptIn: mocks.requestWebPushOptIn,
}));

import { PushEnable } from "./PushEnable";

beforeEach(() => {
  mocks.isNativeApp.mockReturnValue(false);
  mocks.nativePushConsentGiven.mockReturnValue(false);
  mocks.requestNativePushOptIn.mockResolvedValue(true);
  mocks.requestWebPushOptIn.mockResolvedValue(true);
  mocks.currentPushIdentity.mockResolvedValue(`ms_${"a".repeat(43)}`);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PushEnable", () => {
  it("offers to repair web push when browser permission exists but OneSignal is unsubscribed", async () => {
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(),
    });

    const subscription = {
      optedIn: false,
      optIn: vi.fn(async () => {
        subscription.optedIn = true;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const oneSignal = {
      setConsentGiven: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      User: { PushSubscription: subscription },
      Notifications: {},
    };
    mocks.webOneSignal.mockResolvedValue(oneSignal);
    mocks.requestWebPushOptIn.mockImplementation(async () => {
      subscription.optedIn = true;
      return true;
    });

    render(<PushEnable />);

    const repair = await screen.findByRole("button", { name: "Finish setup" });
    expect(screen.getByText(/Permission is allowed, but this device is not subscribed/i)).toBeTruthy();

    fireEvent.click(repair);

    await waitFor(() => expect(mocks.requestWebPushOptIn).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull(),
    );
  });

  it("stays hidden when web push permission and the OneSignal subscription are both on", async () => {
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(),
    });

    let notifyChange: (() => void) | undefined;
    const subscription = {
      optedIn: false,
      optIn: vi.fn(),
      addEventListener: vi.fn((_event: "change", listener: () => void) => {
        notifyChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    mocks.webOneSignal.mockResolvedValue({
      setConsentGiven: vi.fn().mockResolvedValue(undefined),
      login: vi.fn(),
      User: { PushSubscription: subscription },
      Notifications: {},
    });

    const { container } = render(<PushEnable />);

    await screen.findByRole("button", { name: "Finish setup" });
    subscription.optedIn = true;
    act(() => notifyChange?.());

    await waitFor(() => expect(container.childElementCount).toBe(0));
  });

  it("requests native permission and opts the device into OneSignal after a user tap", async () => {
    mocks.isNativeApp.mockReturnValue(true);

    const pushSubscription = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getOptedInAsync: vi.fn().mockResolvedValue(true),
    };
    const oneSignal = {
      setConsentGiven: vi.fn(),
      login: vi.fn().mockResolvedValue(undefined),
      Notifications: {
        // Android 12 and lower can report true without ever showing a prompt;
        // the app-owned consent flag must still keep the Turn on button visible.
        hasPermission: vi.fn().mockResolvedValue(true),
        requestPermission: vi.fn().mockResolvedValue(true),
      },
      User: { pushSubscription },
    };
    mocks.nativeOneSignal.mockResolvedValue(oneSignal);

    render(<PushEnable />);

    const turnOn = await screen.findByRole("button", { name: "Turn on" });
    expect(oneSignal.setConsentGiven).toHaveBeenCalledWith(false);
    expect(oneSignal.setConsentGiven).not.toHaveBeenCalledWith(true);
    fireEvent.click(turnOn);

    await waitFor(() =>
    expect(oneSignal.Notifications.requestPermission).toHaveBeenCalledWith(true),
    );
    expect(mocks.setNativePushConsentGiven).toHaveBeenCalledWith(true);
    expect(mocks.requestNativePushOptIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull());
  });
});
