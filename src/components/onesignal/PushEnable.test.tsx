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

  it("does not re-request native permission when the OS already granted it", async () => {
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
        canRequestPermission: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn().mockResolvedValue(true),
      },
      User: { pushSubscription },
    };
    mocks.nativeOneSignal.mockResolvedValue(oneSignal);

    render(<PushEnable />);

    const turnOn = await screen.findByRole("button", { name: "Turn on" });
    expect(oneSignal.setConsentGiven).toHaveBeenCalledWith(false);
    fireEvent.click(turnOn);

    await waitFor(() => expect(oneSignal.setConsentGiven).toHaveBeenCalledWith(true));
    expect(oneSignal.Notifications.requestPermission).not.toHaveBeenCalled();
    expect(mocks.setNativePushConsentGiven).toHaveBeenCalledWith(true);
    expect(mocks.requestNativePushOptIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull());
  });

  it("grants OneSignal privacy consent before opening the native iOS permission prompt", async () => {
    mocks.isNativeApp.mockReturnValue(true);

    const pushSubscription = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getOptedInAsync: vi.fn().mockResolvedValue(true),
    };
    const oneSignal = {
      setConsentGiven: vi.fn(),
      Notifications: {
        hasPermission: vi.fn().mockResolvedValue(false),
        canRequestPermission: vi.fn().mockResolvedValue(true),
        requestPermission: vi.fn().mockResolvedValue(true),
      },
      User: { pushSubscription },
    };
    mocks.nativeOneSignal.mockResolvedValue(oneSignal);

    render(<PushEnable />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));

    await waitFor(() =>
      expect(oneSignal.Notifications.requestPermission).toHaveBeenCalledWith(false),
    );
    const consentTrueIndex = oneSignal.setConsentGiven.mock.calls.findIndex(([value]) => value === true);
    expect(consentTrueIndex).toBeGreaterThanOrEqual(0);
    expect(oneSignal.setConsentGiven.mock.invocationCallOrder[consentTrueIndex]).toBeLessThan(
      oneSignal.Notifications.requestPermission.mock.invocationCallOrder[0],
    );
    expect(mocks.setNativePushConsentGiven).toHaveBeenCalledWith(true);
    expect(mocks.requestNativePushOptIn).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of hanging when native permission was already denied", async () => {
    mocks.isNativeApp.mockReturnValue(true);

    const oneSignal = {
      setConsentGiven: vi.fn(),
      Notifications: {
        hasPermission: vi.fn().mockResolvedValue(false),
        canRequestPermission: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn(),
      },
      User: {
        pushSubscription: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          getOptedInAsync: vi.fn().mockResolvedValue(false),
        },
      },
    };
    mocks.nativeOneSignal.mockResolvedValue(oneSignal);

    render(<PushEnable />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));

    await screen.findByText(/Notifications are blocked/i);
    expect(oneSignal.Notifications.requestPermission).not.toHaveBeenCalled();
    expect(mocks.setNativePushConsentGiven).toHaveBeenCalledWith(false);
    expect(oneSignal.setConsentGiven).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("button", { name: /Turn on|Open settings/i })).toBeNull();
  });
});
