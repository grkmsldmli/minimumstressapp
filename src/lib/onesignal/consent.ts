"use client";

const NATIVE_PUSH_CONSENT_KEY = "minimumstress.native-push-consent.v1";

/** True only after this installation's user has tapped the native opt-in button. */
export function nativePushConsentGiven(): boolean {
  try {
    return window.localStorage.getItem(NATIVE_PUSH_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function setNativePushConsentGiven(granted: boolean): void {
  try {
    if (granted) window.localStorage.setItem(NATIVE_PUSH_CONSENT_KEY, "granted");
    else window.localStorage.removeItem(NATIVE_PUSH_CONSENT_KEY);
  } catch {
    // Storage can be unavailable in hardened WebViews; fail closed.
  }
}
