"use client";

export const WEB_PUSH_OPT_IN_EVENT = "minimumstress:web-push-opt-in";

export interface WebPushOptInRequest {
  accepted: boolean;
  complete: (success: boolean) => void;
}

/** Route web opt-in through OneSignalInit's serialized Supabase auth coordinator. */
export function requestWebPushOptIn(): Promise<boolean> {
  return new Promise((resolve) => {
    let completed = false;
    const complete = (success: boolean) => {
      if (completed) return;
      completed = true;
      resolve(success);
    };
    const detail: WebPushOptInRequest = { accepted: false, complete };
    window.dispatchEvent(new CustomEvent(WEB_PUSH_OPT_IN_EVENT, { detail }));
    if (!detail.accepted) complete(false);
  });
}
