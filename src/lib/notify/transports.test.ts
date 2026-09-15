import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Resend transport", () => {
  it("requires both the API key and a webhook signing secret for observable delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "not-a-signing-secret");
    const { emailConfigured, emailWebhookConfigured } = await import("./transports");

    expect(emailConfigured()).toBe(true);
    expect(emailWebhookConfigured()).toBe(false);

    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_valid_shape");
    expect(emailWebhookConfigured()).toBe(true);
  });

  it("puts the diagnostic idempotency key on the provider request", async () => {
    vi.stubEnv("RESEND_API_KEY", " re_test_123 ");
    const provider = vi.fn(async () =>
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", provider);
    const { sendEmail } = await import("./transports");

    const result = await sendEmail(
      "admin@example.com",
      { subject: "Check", body: "Body", sms: null },
      { idempotencyKey: "email-health-admin-bucket", correlationId: "a".repeat(64) },
    );

    expect(result).toEqual({ status: "sent", id: "email_123" });
    expect(provider).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_123",
          "Idempotency-Key": "email-health-admin-bucket",
        }),
      }),
    );
    const [, request] = provider.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      tags: [{ name: "notification_id", value: "a".repeat(64) }],
    });
    expect(JSON.parse(String(request.body)).html).toMatch(/<h1[^>]*>Check<\/h1>/);
  });

  it("never copies a provider response body containing an address into durable errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response('{"message":"private@example.com is invalid"}', { status: 422 })
    ));
    const { sendEmail } = await import("./transports");

    const result = await sendEmail("private@example.com", {
      subject: "Check",
      body: "Body",
      sms: null,
    });

    expect(result).toEqual({ status: "dropped", reason: "email 422: provider_4xx" });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });
});
