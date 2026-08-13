import { describe, expect, it } from "vitest";

import { RETRY_DELAYS_MS, delayFor, isTransient } from "./transient";

/**
 * Which failures the app waits out, and which it admits to.
 *
 * The list has to stay short in one direction and complete in the other. Too
 * narrow and somebody signing in with Google meets "JWT issued at future"
 * again — a broken-account screen for a clock a second behind. Too wide and a
 * real outage becomes a spinner that never resolves, which is worse than the
 * message it replaced: at least the message ended.
 */
describe("errors worth another attempt", () => {
  it.each([
    "JWT issued at future",
    "jwt issued at future",
    "Token is not yet valid",
    "iat claim is in the future",
  ])("waits out clock skew: %s", (message) => {
    expect(isTransient(new Error(message))).toBe(true);
  });

  it.each(["Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"])(
    "waits out a request that never arrived: %s",
    (message) => {
      expect(isTransient(new Error(message))).toBe(true);
    },
  );

  /**
   * The important half. Each of these is a real answer about the account, and
   * retrying it would hide that answer behind a wait that ends in the same
   * message several seconds later.
   */
  it.each([
    "Invalid login credentials",
    "Token has expired or is invalid",
    "JWT expired",
    "row-level security policy",
    "No such booking",
    "permission denied for table spaces",
  ])("does not retry a real answer: %s", (message) => {
    expect(isTransient(new Error(message))).toBe(false);
  });

  it("treats a thrown non-error as final rather than guessing", () => {
    expect(isTransient({ weird: true })).toBe(false);
    expect(isTransient(null)).toBe(false);
    expect(isTransient(undefined)).toBe(false);
  });

  /** "JWT expired" must not match the skew pattern by sharing a word. */
  it("keeps an expired token out of the skew case", () => {
    expect(isTransient(new Error("JWT expired"))).toBe(false);
    expect(isTransient(new Error("JWT issued at future"))).toBe(true);
  });
});

describe("how long it waits", () => {
  it("gives up after the last delay", () => {
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      expect(delayFor(i)).toBe(RETRY_DELAYS_MS[i]);
    }
    expect(delayFor(RETRY_DELAYS_MS.length)).toBeNull();
  });

  /**
   * Somebody is looking at a loading box the whole time. Long enough to
   * outlast the skew, short enough that they do not decide it is broken.
   */
  it("stays under five seconds in total", () => {
    const total = RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeLessThanOrEqual(5000);
  });

  it("waits longer each time", () => {
    for (let i = 1; i < RETRY_DELAYS_MS.length; i++) {
      expect(RETRY_DELAYS_MS[i]).toBeGreaterThan(RETRY_DELAYS_MS[i - 1]);
    }
  });
});
