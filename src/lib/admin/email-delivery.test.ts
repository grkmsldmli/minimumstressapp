import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  emailDeliveryConfigurationFingerprint,
  loadEmailDeliveryEvidence,
  recordEmailDeliveryProbe,
} from "./email-delivery";

interface DbResult {
  data: unknown;
  error: unknown;
}

function adminResults(...results: DbResult[]) {
  const chains = results.map((result) => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(async () => result),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    return chain;
  });
  let query = 0;
  const from = vi.fn(() => chains[query++]);
  return { admin: { from } as unknown as SupabaseClient, chains, from };
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_live_current");
  vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_current");
  vi.stubEnv("NOTIFY_FROM_EMAIL", "Minimum Stress <hello@minimumstress.app>");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("email delivery evidence", () => {
  it("reads only the latest event for the latest probe from the current config", async () => {
    const source = adminResults(
      { data: [{ resend_email_id: "email_probe_123" }], error: null },
      {
        data: [{
          event_type: "email.delivered",
          event_created_at: "2026-09-14T12:00:00.000Z",
        }],
        error: null,
      },
    );

    const evidence = await loadEmailDeliveryEvidence(source.admin);

    expect(source.from).toHaveBeenNthCalledWith(1, "resend_email_probes");
    expect(source.chains[0].eq).toHaveBeenCalledWith(
      "configuration_sha256",
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(source.from).toHaveBeenNthCalledWith(2, "resend_email_events");
    expect(source.chains[1].eq).toHaveBeenCalledWith("resend_email_id", "email_probe_123");
    expect(source.chains[1].order).toHaveBeenNthCalledWith(
      1,
      "event_created_at",
      { ascending: false },
    );
    expect(evidence).toMatchObject({
      available: true,
      lastEventAt: "2026-09-14T12:00:00.000Z",
      lastEventType: "email.delivered",
    });
  });

  it("does not trust account-wide events without a matching probe", async () => {
    const source = adminResults({ data: [], error: null });

    const evidence = await loadEmailDeliveryEvidence(source.admin);

    expect(source.from).toHaveBeenCalledTimes(1);
    expect(evidence).toMatchObject({
      available: true,
      lastEventAt: null,
      lastEventType: null,
    });
  });

  it("changes the fingerprint when the active sender configuration changes", () => {
    const first = emailDeliveryConfigurationFingerprint();
    vi.stubEnv("NOTIFY_FROM_EMAIL", "Minimum Stress <ops@minimumstress.app>");

    expect(emailDeliveryConfigurationFingerprint()).not.toBe(first);
  });

  it("records a provider id with only the current config fingerprint", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));
    const admin = { from } as unknown as SupabaseClient;

    await expect(recordEmailDeliveryProbe(admin, "email_probe_123")).resolves.toBe(true);

    expect(from).toHaveBeenCalledWith("resend_email_probes");
    expect(insert).toHaveBeenCalledWith({
      resend_email_id: "email_probe_123",
      configuration_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("treats an idempotent probe replay as success but rejects unknown ids", async () => {
    const insert = vi.fn(async () => ({ error: { code: "23505" } }));
    const admin = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;

    await expect(recordEmailDeliveryProbe(admin, "email_probe_123")).resolves.toBe(true);
    await expect(recordEmailDeliveryProbe(admin, "unknown")).resolves.toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("keeps a missing table or query failure explicit without logging details", async () => {
    const source = adminResults({ data: null, error: { message: "private db detail" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const evidence = await loadEmailDeliveryEvidence(source.admin);

    expect(evidence).toMatchObject({
      available: false,
      lastEventAt: null,
      lastEventType: null,
    });
    expect(log).toHaveBeenCalledWith("Email delivery evidence query failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private db detail");
  });
});
