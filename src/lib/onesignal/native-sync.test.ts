// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  NATIVE_PUSH_OPT_IN_EVENT,
  type NativePushOptInRequest,
  requestNativePushOptIn,
} from "./native-sync";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("native push opt-in coordinator", () => {
  it("fails closed when the auth coordinator is not mounted", async () => {
    await expect(requestNativePushOptIn()).resolves.toBe(false);
  });

  it("waits for the mounted auth coordinator", async () => {
    const listener = (event: Event) => {
      const request = (event as CustomEvent<NativePushOptInRequest>).detail;
      request.accepted = true;
      queueMicrotask(() => request.complete(true));
    };
    window.addEventListener(NATIVE_PUSH_OPT_IN_EVENT, listener);
    cleanup = () => window.removeEventListener(NATIVE_PUSH_OPT_IN_EVENT, listener);

    await expect(requestNativePushOptIn()).resolves.toBe(true);
  });
});
