import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ rpc }),
}));

import { authorizeCronRequest } from "./cron-auth";

function request(token?: string): Request {
  return new Request("https://minimumstress.app/api/cron/notifications", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  rpc.mockResolvedValue({ data: false, error: null });
});

describe("cron authorization", () => {
  it("accepts Vercel's configured secret without a database round trip", async () => {
    const secret = "v".repeat(48);
    vi.stubEnv("CRON_SECRET", secret);

    await expect(authorizeCronRequest(request(secret))).resolves.toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a Vault scheduler token by its digest", async () => {
    vi.stubEnv("CRON_SECRET", "v".repeat(48));
    rpc.mockResolvedValue({ data: true, error: null });

    await expect(authorizeCronRequest(request("s".repeat(64)))).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("verify_notification_scheduler_token", {
      p_token_sha256: "9791065143e72360c9cff795b7d2a8086e8f34715478dd5f5b7791370b6e1e80",
    });
  });

  it("rejects malformed and unknown tokens without revealing configuration", async () => {
    await expect(authorizeCronRequest(request("short"))).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    await expect(authorizeCronRequest(request("x".repeat(64)))).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("fails closed when the digest lookup is unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect(authorizeCronRequest(request("x".repeat(64)))).resolves.toMatchObject({
      ok: false,
      status: 503,
    });
  });
});
