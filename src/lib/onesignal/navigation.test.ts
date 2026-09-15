// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeNotificationsScreenRequest,
  requestNotificationsScreen,
} from "./navigation";

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("OneSignal notification navigation", () => {
  it("consumes and removes a cold web-push URL marker exactly once", () => {
    window.history.replaceState({}, "", "/?open=notifications&ref=push#top");

    expect(consumeNotificationsScreenRequest()).toBe(true);
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe("/?ref=push#top");
    expect(consumeNotificationsScreenRequest()).toBe(false);
  });

  it("persists a native click until the authenticated app is ready", () => {
    requestNotificationsScreen();

    expect(consumeNotificationsScreenRequest()).toBe(true);
    expect(consumeNotificationsScreenRequest()).toBe(false);
  });
});
