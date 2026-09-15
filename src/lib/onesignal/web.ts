"use client";

export interface OneSignalWebApi {
  init(options: {
    appId: string;
    allowLocalhostAsSecureOrigin?: boolean;
    requiresUserPrivacyConsent?: boolean;
  }): Promise<void>;
  setConsentRequired(required: boolean): Promise<void>;
  setConsentGiven(granted: boolean): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  User: {
    PushSubscription: {
      optedIn?: boolean;
      optIn?: () => Promise<void> | void;
      addEventListener?: (event: "change", listener: (change: unknown) => void) => void;
      removeEventListener?: (event: "change", listener: (change: unknown) => void) => void;
    };
  };
  Notifications?: {
    requestPermission?: () => Promise<void>;
    addEventListener?: (event: "click", listener: () => void) => void;
    removeEventListener?: (event: "click", listener: () => void) => void;
  };
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(os: OneSignalWebApi) => void | Promise<void>>;
    __oneSignalStarted?: boolean;
  }
}

export function withWebOneSignal(
  callback: (oneSignal: OneSignalWebApi) => void | Promise<void>,
): void {
  window.OneSignalDeferred = window.OneSignalDeferred ?? [];
  window.OneSignalDeferred.push(callback);
}

export function webOneSignal(): Promise<OneSignalWebApi> {
  return new Promise((resolve) => withWebOneSignal(resolve));
}
