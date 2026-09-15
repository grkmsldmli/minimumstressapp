// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativeApp: vi.fn(),
  isSiteHost: vi.fn(),
  nativeOneSignal: vi.fn(),
  nativePushConsentGiven: vi.fn(),
  currentPushIdentity: vi.fn(),
  requestNotificationsScreen: vi.fn(),
  withWebOneSignal: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/lib/native", () => ({ isNativeApp: mocks.isNativeApp }));
vi.mock("@/lib/site-host", () => ({ isSiteHost: mocks.isSiteHost }));
vi.mock("@/lib/onesignal/client", () => ({
  nativeOneSignal: mocks.nativeOneSignal,
  currentPushIdentity: mocks.currentPushIdentity,
}));
vi.mock("@/lib/onesignal/config", () => ({
  publicOneSignalAppId: () => "test-app-id",
}));
vi.mock("@/lib/onesignal/consent", () => ({
  nativePushConsentGiven: mocks.nativePushConsentGiven,
}));
vi.mock("@/lib/onesignal/navigation", () => ({
  requestNotificationsScreen: mocks.requestNotificationsScreen,
}));
vi.mock("@/lib/onesignal/web", () => ({
  withWebOneSignal: mocks.withWebOneSignal,
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: { onAuthStateChange: mocks.onAuthStateChange },
  }),
}));

import { OneSignalInit } from "./OneSignalInit";

beforeEach(() => {
  mocks.isNativeApp.mockReturnValue(false);
  mocks.isSiteHost.mockReturnValue(false);
  mocks.nativePushConsentGiven.mockReturnValue(false);
  mocks.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: mocks.unsubscribe } },
  });
  vi.stubGlobal("Notification", { permission: "default" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete window.__oneSignalStarted;
  document.querySelectorAll('script[src*="OneSignalSDK"]').forEach((script) => script.remove());
});

describe("OneSignalInit privacy gate", () => {
  it("requires consent before web SDK initialization and sends no identity without permission", async () => {
    const oneSignal = {
      setConsentRequired: vi.fn().mockResolvedValue(undefined),
      setConsentGiven: vi.fn().mockResolvedValue(undefined),
      init: vi.fn().mockResolvedValue(undefined),
      login: vi.fn(),
      logout: vi.fn(),
      User: { PushSubscription: {} },
      Notifications: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };
    mocks.withWebOneSignal.mockImplementation((callback) => void callback(oneSignal));

    render(<OneSignalInit />);

    await waitFor(() => expect(oneSignal.init).toHaveBeenCalledTimes(1));
    expect(oneSignal.setConsentRequired).toHaveBeenCalledWith(true);
    expect(oneSignal.setConsentGiven).toHaveBeenCalledWith(false);
    expect(oneSignal.init).toHaveBeenCalledWith(expect.objectContaining({
      appId: "test-app-id",
      requiresUserPrivacyConsent: true,
    }));
    expect(oneSignal.setConsentRequired.mock.invocationCallOrder[0])
      .toBeLessThan(oneSignal.setConsentGiven.mock.invocationCallOrder[0]);
    expect(oneSignal.setConsentGiven.mock.invocationCallOrder[0])
      .toBeLessThan(oneSignal.init.mock.invocationCallOrder[0]);
    expect(oneSignal.login).not.toHaveBeenCalled();
    expect(mocks.currentPushIdentity).not.toHaveBeenCalled();
  });

  it("registers web auth while privacy-gated init is still waiting for consent", async () => {
    let releaseInit: (() => void) | undefined;
    const delayedInit = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });
    const oneSignal = {
      setConsentRequired: vi.fn().mockResolvedValue(undefined),
      setConsentGiven: vi.fn().mockResolvedValue(undefined),
      init: vi.fn().mockReturnValue(delayedInit),
      login: vi.fn(),
      logout: vi.fn(),
      User: { PushSubscription: {} },
      Notifications: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };
    mocks.withWebOneSignal.mockImplementation((callback) => void callback(oneSignal));

    render(<OneSignalInit />);

    await waitFor(() => expect(oneSignal.init).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.onAuthStateChange).toHaveBeenCalledTimes(1));
    expect(oneSignal.Notifications.addEventListener).not.toHaveBeenCalled();

    releaseInit?.();
    await waitFor(() =>
      expect(oneSignal.Notifications.addEventListener).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
      ),
    );
  });

  it("does not let a stale native sign-out log out the next signed-in user", async () => {
    mocks.isNativeApp.mockReturnValue(true);
    mocks.nativePushConsentGiven.mockReturnValue(true);
    let authChange: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
    mocks.onAuthStateChange.mockImplementation((callback) => {
      authChange = callback;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });

    let releaseStaleLogout: (() => void) | undefined;
    const staleLogout = new Promise<void>((resolve) => {
      releaseStaleLogout = resolve;
    });
    const hasPermission = vi.fn().mockResolvedValue(true);
    const native = {
      setConsentGiven: vi.fn(),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockReturnValue(staleLogout),
      Notifications: {
        hasPermission,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      User: { pushSubscription: { optIn: vi.fn().mockResolvedValue(undefined) } },
    };
    mocks.nativeOneSignal.mockResolvedValue(native);
    mocks.currentPushIdentity.mockResolvedValue("ms_next_user");

    render(<OneSignalInit />);
    await waitFor(() => expect(authChange).toBeTypeOf("function"));

    authChange?.("SIGNED_OUT", null);
    await waitFor(() => expect(native.logout).toHaveBeenCalledTimes(1));
    authChange?.("SIGNED_IN", { user: { id: "user-b" } });
    expect(native.login).not.toHaveBeenCalled();

    releaseStaleLogout?.();
    await waitFor(() => expect(native.login).toHaveBeenCalledWith("ms_next_user"));
    expect(native.logout.mock.invocationCallOrder[0])
      .toBeLessThan(native.login.mock.invocationCallOrder[0]);
  });

  it("serializes web sign-out before binding the next signed-in user", async () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    let authChange: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
    mocks.onAuthStateChange.mockImplementation((callback) => {
      authChange = callback;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });

    let releaseStaleLogout: (() => void) | undefined;
    const staleLogout = new Promise<void>((resolve) => {
      releaseStaleLogout = resolve;
    });
    const oneSignal = {
      setConsentRequired: vi.fn().mockResolvedValue(undefined),
      setConsentGiven: vi.fn().mockResolvedValue(undefined),
      init: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockReturnValue(staleLogout),
      User: { PushSubscription: { optIn: vi.fn().mockResolvedValue(undefined) } },
      Notifications: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };
    mocks.withWebOneSignal.mockImplementation((callback) => void callback(oneSignal));
    mocks.currentPushIdentity.mockResolvedValue("ms_next_web_user");

    render(<OneSignalInit />);
    await waitFor(() => expect(authChange).toBeTypeOf("function"));

    authChange?.("SIGNED_OUT", null);
    await waitFor(() => expect(oneSignal.logout).toHaveBeenCalledTimes(1));
    authChange?.("SIGNED_IN", { user: { id: "user-b" } });
    expect(oneSignal.login).not.toHaveBeenCalled();

    releaseStaleLogout?.();
    await waitFor(() => expect(oneSignal.login).toHaveBeenCalledWith("ms_next_web_user"));
    expect(oneSignal.logout.mock.invocationCallOrder[0])
      .toBeLessThan(oneSignal.login.mock.invocationCallOrder[0]);
  });
});
