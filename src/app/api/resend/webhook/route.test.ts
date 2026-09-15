import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { from, insert, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from, rpc }),
}));

import { POST } from "./route";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const SECRET_BYTES = Buffer.from("minimum-stress-resend-test-secret", "utf8");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const CORRELATION_ID = "a".repeat(64);

function signedRequest(
  payload: unknown,
  options: { signature?: string; id?: string } = {},
): Request {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const id = options.id ?? "msg_test_123";
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  const signature = options.signature ?? `v1,${createHmac("sha256", SECRET_BYTES)
    .update(`${id}.${timestamp}.${body}`, "utf8")
    .digest("base64")}`;

  return new Request("https://minimumstress.app/api/resend/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    },
    body,
  });
}

function event(type = "email.delivered") {
  return {
    type,
    created_at: NOW.toISOString(),
    data: {
      email_id: "email_123",
      to: ["private@example.com"],
      tags: { notification_id: CORRELATION_ID },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
  from.mockReturnValue({ insert });
  insert.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/resend/webhook", () => {
  it("fails closed before database access when the secret is absent", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const response = await POST(signedRequest(event()));

    expect(response.status).toBe(500);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before database access", async () => {
    const response = await POST(signedRequest(event(), { signature: "v1,wrong" }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    "email.delivered",
    "email.delivery_delayed",
    "email.failed",
    "email.bounced",
    "email.complained",
    "email.suppressed",
  ])("stores signed %s evidence without payload PII", async (type) => {
    const response = await POST(signedRequest(event(type)));

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("resend_email_events");
    expect(insert).toHaveBeenCalledWith({
      svix_id: "msg_test_123",
      resend_email_id: "email_123",
      notification_correlation_id: CORRELATION_ID,
      event_type: type,
      event_created_at: NOW.toISOString(),
    });
    expect(JSON.stringify(insert.mock.calls[0]?.[0])).not.toContain("private@example.com");
    expect(rpc).toHaveBeenCalledWith("apply_resend_delivery_event", {
      p_resend_email_id: "email_123",
      p_notification_correlation_id: CORRELATION_ID,
      p_event_type: type,
      p_event_created_at: NOW.toISOString(),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("private@example.com");
  });

  it("acknowledges a signed unsupported event without touching the database", async () => {
    const response = await POST(signedRequest(event("email.opened")));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, ignored: true });
    expect(from).not.toHaveBeenCalled();
  });

  it("acknowledges a replay whose svix id is already stored", async () => {
    insert.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });
    const response = await POST(signedRequest(event()));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, duplicate: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns 500 so Resend retries a persistence failure", async () => {
    insert.mockResolvedValueOnce({ error: { code: "XX000", message: "private detail" } });
    const response = await POST(signedRequest(event()));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("private detail");
    expect(text).not.toContain(SECRET);
  });
});
