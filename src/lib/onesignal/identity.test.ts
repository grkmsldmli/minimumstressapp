import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { oneSignalExternalId } from "./identity";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SECRET_A = "identity-test-secret-a-that-is-long-enough";
const SECRET_B = "identity-test-secret-b-that-is-long-enough";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OneSignal external identity", () => {
  it("is stable, opaque and not a UUID", () => {
    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", SECRET_A);

    const first = oneSignalExternalId(USER_A);
    const repeated = oneSignalExternalId(USER_A);

    expect(repeated).toBe(first);
    expect(first).toMatch(/^ms_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain(USER_A);
    expect(first).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("does not collapse different accounts or different secrets onto one alias", () => {
    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", SECRET_A);
    const userA = oneSignalExternalId(USER_A);
    const userB = oneSignalExternalId(USER_B);

    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", SECRET_B);
    const rotated = oneSignalExternalId(USER_A);

    expect(userA).not.toBe(userB);
    expect(rotated).not.toBe(userA);
  });

  it("is keyed rather than a client-reproducible hash of the public user id", () => {
    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", SECRET_A);
    const unkeyed = createHash("sha256").update(USER_A, "utf8").digest("base64url");

    expect(oneSignalExternalId(USER_A)).not.toBe(`ms_${unkeyed}`);
  });

  it("uses the server-only Supabase secret only as a migration fallback", () => {
    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET_A);
    const fallback = oneSignalExternalId(USER_A);

    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", SECRET_B);
    const dedicated = oneSignalExternalId(USER_A);

    expect(fallback).toMatch(/^ms_[A-Za-z0-9_-]{43}$/);
    expect(dedicated).not.toBe(fallback);
  });

  it("fails closed when no sufficiently strong server secret is configured", () => {
    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", "too-short");
    vi.stubEnv("SUPABASE_SECRET_KEY", "also-too-short");

    expect(oneSignalExternalId(USER_A)).toBeNull();
  });
});
