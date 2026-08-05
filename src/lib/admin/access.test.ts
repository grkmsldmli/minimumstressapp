import { afterEach, describe, expect, it, vi } from "vitest";

import { adminUnconfigured, isStaff, safetyRecipient, staffEmails } from "./access";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isStaff", () => {
  it("admits an address on the list", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(isStaff("owner@example.com")).toBe(true);
  });

  it("admits any of several", () => {
    vi.stubEnv("ADMIN_EMAILS", "a@example.com,b@example.com , c@example.com");
    expect(isStaff("b@example.com")).toBe(true);
    expect(isStaff("c@example.com")).toBe(true);
  });

  /** The same mailbox, and locking somebody out of their own dashboard over a capital letter is absurd. */
  it("ignores case on both sides", () => {
    vi.stubEnv("ADMIN_EMAILS", "Owner@Example.com");
    expect(isStaff("owner@example.com")).toBe(true);
    expect(isStaff("OWNER@EXAMPLE.COM")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(isStaff("  owner@example.com  ")).toBe(true);
  });

  it("refuses an address that is not on it", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(isStaff("someone@example.com")).toBe(false);
  });

  /**
   * The failure that would matter most. Treating "unset" as "everybody" is how
   * a staging deploy with no configuration serves lease documents and home
   * addresses to whoever finds the URL.
   */
  it.each([undefined, ""])("grants nothing when the list is %s", (value) => {
    vi.stubEnv("ADMIN_EMAILS", value as string);
    expect(isStaff("owner@example.com")).toBe(false);
    expect(isStaff("anyone@example.com")).toBe(false);
  });

  it.each([null, undefined, ""])("refuses %s as an address", (email) => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(isStaff(email)).toBe(false);
  });

  /** A near-miss must not pass — no prefix or suffix matching anywhere. */
  it.each([
    "owner@example.com.attacker.net",
    "notowner@example.com",
    "owner@example.co",
    "owner@example.com ", // trailing space is trimmed, so this one is the real address
  ])("judges %s on the whole address", (email) => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(isStaff(email)).toBe(email.trim() === "owner@example.com");
  });
});

describe("staffEmails", () => {
  it("drops empty entries left by a trailing comma", () => {
    vi.stubEnv("ADMIN_EMAILS", "a@example.com,,b@example.com,");
    expect(staffEmails()).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("adminUnconfigured", () => {
  it("is true when nobody has been named", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(adminUnconfigured()).toBe(true);
  });

  it("is false once somebody has", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(adminUnconfigured()).toBe(false);
  });
});

describe("safetyRecipient", () => {
  it("uses the dedicated address when one is set", () => {
    vi.stubEnv("SAFETY_ALERT_EMAIL", "safety@minimumstress.app");
    vi.stubEnv("ADMIN_EMAILS", "owner@minimumstress.app");
    expect(safetyRecipient()).toBe("safety@minimumstress.app");
  });

  /**
   * The case this exists for. Nothing ever told anybody to set the dedicated
   * variable, so a safety report reached the queue and nobody was told it had.
   */
  it("falls back to the operator when it is not", () => {
    vi.stubEnv("SAFETY_ALERT_EMAIL", "");
    vi.stubEnv("ADMIN_EMAILS", "owner@minimumstress.app, second@minimumstress.app");
    expect(safetyRecipient()).toBe("owner@minimumstress.app");
  });

  it("treats whitespace as not set", () => {
    vi.stubEnv("SAFETY_ALERT_EMAIL", "   ");
    vi.stubEnv("ADMIN_EMAILS", "owner@minimumstress.app");
    expect(safetyRecipient()).toBe("owner@minimumstress.app");
  });

  it("has nobody to tell when neither is configured", () => {
    vi.stubEnv("SAFETY_ALERT_EMAIL", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(safetyRecipient()).toBeNull();
  });
});
