import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetForTests } from "@/lib/api/rate-limit";

vi.mock("server-only", () => ({}));

const {
  configurationFingerprint,
  configured,
  recordAdminAction,
  recordEmailDeliveryProbe,
  sendEmail,
  staff,
} = vi.hoisted(() => ({
  configurationFingerprint: { value: "a".repeat(64) },
  configured: { value: true },
  recordAdminAction: vi.fn(async () => undefined),
  recordEmailDeliveryProbe: vi.fn(async () => true),
  sendEmail: vi.fn(async () => ({ status: "sent" as const, id: "email_test_123" })),
  staff: {
    value: { staffId: "11111111-1111-4111-8111-111111111111", staffEmail: "admin@example.com" },
  },
}));

vi.mock("@/lib/admin/guard", () => ({
  staffOrRefusal: async () => staff.value,
}));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction }));
vi.mock("@/lib/admin/email-delivery", () => ({
  emailDeliveryConfigurationFingerprint: () => configurationFingerprint.value,
  recordEmailDeliveryProbe,
}));
vi.mock("@/lib/notify/transports", () => ({
  emailWebhookConfigured: () => configured.value,
  sendEmail,
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from: vi.fn() }),
}));

import { POST } from "./route";

function request(origin = "https://minimumstress.app", body?: string): NextRequest {
  return new NextRequest("https://minimumstress.app/api/admin/system/test-email", {
    method: "POST",
    headers: { origin, ...(body ? { "content-type": "application/json" } : {}) },
    body,
  });
}

beforeEach(() => {
  resetForTests();
  configured.value = true;
  staff.value = {
    staffId: "11111111-1111-4111-8111-111111111111",
    staffEmail: "admin@example.com",
  };
  sendEmail.mockResolvedValue({ status: "sent", id: "email_test_123" });
  recordEmailDeliveryProbe.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/system/test-email", () => {
  it("sends only to the signed-in staff email and waits for webhook proof", async () => {
    const response = await POST(request(
      "https://minimumstress.app",
      JSON.stringify({ to: "attacker@example.com" }),
    ));

    expect(response.status).toBe(202);
    expect(sendEmail).toHaveBeenCalledWith(
      "admin@example.com",
      expect.objectContaining({ subject: "Minimum Stress email delivery check" }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^email-health-11111111-1111-4111-8111-111111111111-\d+-a{64}$/,
        ),
      }),
    );
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain("attacker@example.com");
    expect(recordEmailDeliveryProbe).toHaveBeenCalledWith(expect.anything(), "email_test_123");
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "send_email_delivery_test",
        targetId: "email_test_123",
        metadata: { provider: "resend", outcome: "sent" },
      }),
    );
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(request("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails clearly when sending or signed receipts are not configured", async () => {
    configured.value = false;
    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("limits repeated clicks to one provider request per five minutes", async () => {
    expect((await POST(request())).status).toBe(202);
    const repeated = await POST(request());

    expect(repeated.status).toBe(429);
    expect(repeated.headers.get("retry-after")).toBeTruthy();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not expose a provider failure detail", async () => {
    sendEmail.mockResolvedValueOnce({
      status: "retry",
      reason: "resend private provider detail",
    } as never);
    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).not.toContain("private provider detail");
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: { provider: "resend", outcome: "retry" } }),
    );
  });

  it("does not claim success when the accepted probe cannot be recorded", async () => {
    recordEmailDeliveryProbe.mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { provider: "resend", outcome: "evidence_not_recorded" },
      }),
    );
  });
});
