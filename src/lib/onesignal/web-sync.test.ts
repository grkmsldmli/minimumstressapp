// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  WEB_PUSH_OPT_IN_EVENT,
  type WebPushOptInRequest,
  requestWebPushOptIn,
} from "./web-sync";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("web push opt-in coordinator", () => {
  it("fails closed when the auth coordinator is not mounted", async () => {
    await expect(requestWebPushOptIn()).resolves.toBe(false);
  });

  it("waits for the mounted auth coordinator", async () => {
    const listener = (event: Event) => {
      const request = (event as CustomEvent<WebPushOptInRequest>).detail;
      request.accepted = true;
      queueMicrotask(() => request.complete(true));
    };
    window.addEventListener(WEB_PUSH_OPT_IN_EVENT, listener);
    cleanup = () => window.removeEventListener(WEB_PUSH_OPT_IN_EVENT, listener);

    await expect(requestWebPushOptIn()).resolves.toBe(true);
  });
});
