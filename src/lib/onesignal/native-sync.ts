"use client";

export const NATIVE_PUSH_OPT_IN_EVENT = "minimumstress:native-push-opt-in";

export interface NativePushOptInRequest {
  accepted: boolean;
  complete: (success: boolean) => void;
}

/**
 * Ask the single auth coordinator in OneSignalInit to bind the current account
 * and opt this installation in. The synchronous `accepted` handshake makes a
 * missing coordinator fail closed instead of creating an anonymous subscriber.
 */
export function requestNativePushOptIn(): Promise<boolean> {
  return new Promise((resolve) => {
    let completed = false;
    const complete = (success: boolean) => {
      if (completed) return;
      completed = true;
      resolve(success);
    };
    const detail: NativePushOptInRequest = { accepted: false, complete };
    window.dispatchEvent(new CustomEvent(NATIVE_PUSH_OPT_IN_EVENT, { detail }));
    if (!detail.accepted) complete(false);
  });
}
