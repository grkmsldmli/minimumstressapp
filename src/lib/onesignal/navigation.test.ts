// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeNotificationDestination,
  consumeNotificationsScreenRequest,
  requestNotificationDestination,
  requestNotificationsScreen,
} from "./navigation";

const TOKEN = "182d1e8f-14d2-8dc1-a72b-59c562bf88a7";

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

  it("carries an opaque notification token across a native cold launch", () => {
    requestNotificationDestination(TOKEN);

    expect(consumeNotificationDestination()).toEqual({ notificationId: TOKEN });
    expect(consumeNotificationDestination()).toBeNull();
  });

  it("consumes a direct web target once and strips it from the address bar", () => {
    window.history.replaceState({}, "", `/?open=notification&notification=${TOKEN}&ref=push`);

    expect(consumeNotificationDestination()).toEqual({ notificationId: TOKEN });
    expect(window.location.pathname + window.location.search).toBe("/?ref=push");
  });

  it("fails an invalid token closed to the generic notification list", () => {
    requestNotificationDestination("a-booking-id-must-never-be-used-here");
    expect(consumeNotificationDestination()).toEqual({ notificationId: null });
  });
});
