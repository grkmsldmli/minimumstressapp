import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const PUSH_ALIAS = `ms_${"a".repeat(43)}`;
const NAV_TOKEN = "182d1e8f-14d2-8dc1-a72b-59c562bf88a7";

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

  it("sends marketing through an RFC 8058 one-click envelope", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("MARKETING_FROM_EMAIL", "Minimum Stress <news@minimumstress.app>");
    const provider = vi.fn(async () =>
      new Response(JSON.stringify({ id: "email_marketing_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", provider);
    const { sendMarketingEmail } = await import("./transports");
    const unsubscribeUrl =
      "https://minimumstress.app/api/marketing/unsubscribe?token=11111111-1111-4111-8111-111111111111";

    await expect(
      sendMarketingEmail(
        "person@example.com",
        { subject: "Come back", text: "Text", html: "<p>Text</p>", unsubscribeUrl },
        { idempotencyKey: "marketing-key", correlationId: "b".repeat(64) },
      ),
    ).resolves.toEqual({ status: "sent", id: "email_marketing_1" });

    const [, request] = provider.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      from: "Minimum Stress <news@minimumstress.app>",
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [{ name: "notification_id", value: "b".repeat(64) }],
    });
  });

  it("refuses a marketing unsubscribe URL outside the app", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const { sendMarketingEmail } = await import("./transports");

    await expect(
      sendMarketingEmail(
        "person@example.com",
        {
          subject: "Come back",
          text: "Text",
          html: "<p>Text</p>",
          unsubscribeUrl: "https://attacker.example/unsubscribe",
        },
        { idempotencyKey: "marketing-key", correlationId: "b".repeat(64) },
      ),
    ).resolves.toEqual({ status: "dropped", reason: "email invalid_unsubscribe_url" });
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("OneSignal transport", () => {
  it("uses the public app id fallback but still requires the server REST API key", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "");
    const { pushConfigured } = await import("./transports");
    expect(pushConfigured()).toBe(false);

    vi.stubEnv("ONESIGNAL_REST_API_KEY", " os_rest_secret ");
    expect(pushConfigured()).toBe(true);
  });

  it("targets an opaque external_id with generic copy and RFC UUID idempotency", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", " os_rest_secret ");
    vi.stubEnv("ONESIGNAL_APP_ID", "app-test-id");
    const provider = vi.fn(async () =>
      new Response(JSON.stringify({ id: "notification_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", provider);
    const { sendPush } = await import("./transports");
    const idempotencyKey = "182d1e8f-14d2-8dc1-a72b-59c562bf88a7";

    const result = await sendPush(
      PUSH_ALIAS,
      {
        title: "Booking confirmed",
        body: "Open Minimum Stress for details.",
        url: "https://minimumstress.app/",
      },
      { idempotencyKey, navigationToken: NAV_TOKEN },
    );

    expect(result).toEqual({ status: "sent", id: "notification_123" });
    expect(provider).toHaveBeenCalledWith(
      "https://api.onesignal.com/notifications",
      expect.objectContaining({
        headers: {
          Authorization: "Key os_rest_secret",
          "Content-Type": "application/json",
        },
      }),
    );
    const [, request] = provider.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      app_id: "app-test-id",
      include_aliases: { external_id: [PUSH_ALIAS] },
      target_channel: "push",
      headings: { en: "Booking confirmed" },
      contents: { en: "Open Minimum Stress for details." },
      web_url: "https://minimumstress.app/",
      data: {
        minimumstress_destination: "notification",
        minimumstress_notification_id: NAV_TOKEN,
      },
      ios_sound: "default",
      ios_badgeType: "Increase",
      ios_badgeCount: 1,
      android_sound: "default",
      priority: 10,
      idempotency_key: idempotencyKey,
    });
  });

  it("treats a successful response without an id as terminally unsubscribed", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "os_rest_secret");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ errors: ["All included players are not subscribed"] }), {
        status: 200,
      })
    ));
    const { sendPush } = await import("./transports");

    await expect(sendPush(
      PUSH_ALIAS,
      { title: "Update", body: "Open Minimum Stress.", url: "https://minimumstress.app/" },
      { idempotencyKey: NAV_TOKEN, navigationToken: NAV_TOKEN },
    )).resolves.toEqual({ status: "skipped", reason: "no subscribed push destination" });
  });

  it.each([429, 500, 503])("retries transient HTTP %s responses", async (status) => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "os_rest_secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider details", { status })));
    const { sendPush } = await import("./transports");

    const result = await sendPush(
      PUSH_ALIAS,
      { title: "Update", body: "Open Minimum Stress.", url: "https://minimumstress.app/" },
      { idempotencyKey: NAV_TOKEN, navigationToken: NAV_TOKEN },
    );

    expect(result).toEqual({
      status: "retry",
      reason: status === 429 ? "push 429: rate_limited" : `push ${status}: provider_5xx`,
    });
  });

  it("drops permanent 4xx responses without retaining provider or identity details", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "os_rest_secret");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response('{"errors":["ms_private_alias is invalid"]}', { status: 400 })
    ));
    const { sendPush } = await import("./transports");

    const result = await sendPush(
      PUSH_ALIAS,
      { title: "Update", body: "Open Minimum Stress.", url: "https://minimumstress.app/" },
      { idempotencyKey: NAV_TOKEN, navigationToken: NAV_TOKEN },
    );

    expect(result).toEqual({ status: "dropped", reason: "push 400: provider_4xx" });
    expect(JSON.stringify(result)).not.toContain(PUSH_ALIAS);
  });

  it("fails closed before fetch if a raw or malformed identity reaches the transport", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "os_rest_secret");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const { sendPush } = await import("./transports");

    await expect(sendPush(
      "11111111-1111-4111-8111-111111111111",
      { title: "Update", body: "Open Minimum Stress.", url: "https://minimumstress.app/" },
      { idempotencyKey: NAV_TOKEN, navigationToken: NAV_TOKEN },
    )).resolves.toEqual({ status: "dropped", reason: "push invalid_external_id" });
    expect(provider).not.toHaveBeenCalled();
  });
});
