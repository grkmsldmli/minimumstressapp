import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const claimed = new Set<string>();
  const sendEmail = vi.fn();
  const sendPush = vi.fn();
  const sendSms = vi.fn();
  const rpc = vi.fn();
  let emailIsConfigured = true;
  let externalId: string | null = null;

  const from = vi.fn((table: string) => ({
    insert: async (row: Record<string, unknown>) => {
      if (table === "notifications") {
        const key = String(row.dedupe_key);
        if (claimed.has(key)) return { error: { code: "23505" } };
        claimed.add(key);
        inserted.push(row);
      }
      return { error: null };
    },
    update: (row: Record<string, unknown>) => {
      updates.push(row);
      const chain = { eq: vi.fn(() => chain) };
      return chain;
    },
  }));

  return {
    inserted,
    updates,
    claimed,
    sendEmail,
    sendPush,
    sendSms,
    rpc,
    from,
    get emailIsConfigured() { return emailIsConfigured; },
    set emailIsConfigured(value: boolean) { emailIsConfigured = value; },
    get externalId() { return externalId; },
    set externalId(value: string | null) { externalId = value; },
  };
});

vi.mock("../supabase/server", () => ({
  supabaseAdmin: () => ({ from: state.from, rpc: state.rpc }),
}));

vi.mock("./transports", () => ({
  emailConfigured: () => state.emailIsConfigured,
  pushConfigured: () => true,
  smsConfigured: () => false,
  sendEmail: (...args: unknown[]) => state.sendEmail(...args),
  sendPush: (...args: unknown[]) => state.sendPush(...args),
  sendSms: (...args: unknown[]) => state.sendSms(...args),
}));

vi.mock("../onesignal/identity", () => ({
  oneSignalExternalId: () => state.externalId,
}));

import {
  notify,
  oneSignalPushIdempotencyKey,
  providerCorrelationId,
  providerIdempotencyKey,
  retryPending,
} from "./send";

beforeEach(() => {
  state.inserted.length = 0;
  state.updates.length = 0;
  state.claimed.clear();
  state.from.mockClear();
  state.rpc.mockReset();
  state.sendEmail.mockReset();
  state.sendPush.mockReset();
  state.sendSms.mockReset();
  state.emailIsConfigured = true;
  state.externalId = null;
  state.rpc.mockResolvedValue({ data: true, error: null });
  state.sendEmail.mockResolvedValue({ status: "sent", id: "email_123" });
  state.sendPush.mockResolvedValue({ status: "sent", id: "push_123" });
});

describe("notification outbox", () => {
  it("stores the exact rendered envelope before sending with a stable provider key", async () => {
    const result = await notify({
      kind: "refund_decided",
      recipient: { userId: null, name: "Operations", email: "ops@example.com" },
      subjectId: "refund-1",
      context: { refundedCents: 2500, note: "Approved after review" },
    });

    expect(result.email).toBe("sent");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      user_id: null,
      destination: "ops@example.com",
      dedupe_key: "refund_decided:refund-1:email",
      attempts: 1,
      provider_correlation_id: providerCorrelationId("refund_decided:refund-1:email"),
      lease_token: expect.any(String),
      lease_until: expect.any(String),
      message_snapshot: {
        version: 1,
        message: expect.objectContaining({
          subject: expect.any(String),
          body: expect.stringContaining("$25.00"),
          html: expect.stringContaining("<!doctype html>"),
        }),
      },
    });
    expect(state.sendEmail).toHaveBeenCalledWith(
      "ops@example.com",
      expect.objectContaining({ body: expect.stringContaining("Approved after review") }),
      {
        idempotencyKey: providerIdempotencyKey("refund_decided:refund-1:email"),
        correlationId: providerCorrelationId("refund_decided:refund-1:email"),
      },
    );
    expect(state.rpc).toHaveBeenCalledWith(
      "record_notification_acceptance",
      expect.objectContaining({
        p_dedupe_key: "refund_decided:refund-1:email",
        p_provider_message_id: "email_123",
        p_lease_token: expect.any(String),
      }),
    );
  });

  it("keeps an exact queued envelope when the provider is not configured", async () => {
    state.emailIsConfigured = false;

    await expect(notify({
      kind: "booking_confirmed",
      recipient: { userId: "user-1", email: "user@example.com" },
      subjectId: "booking-provider-gap",
      bookingId: "booking-provider-gap",
      expiresAt: "2026-09-20T10:00:00.000Z",
      context: { spaceName: "Willow", when: "Friday at 10:00 AM" },
    })).resolves.toMatchObject({ email: "skipped" });

    expect(state.inserted[0]).toMatchObject({
      destination: "user@example.com",
      message_snapshot: { version: 1, message: expect.any(Object) },
      expires_at: "2026-09-20T10:00:00.000Z",
    });
    expect(state.updates.at(-1)).toMatchObject({
      last_error: "email provider is not configured",
      lease_token: null,
      lease_until: null,
    });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("defers a sensitive first send until the state-gated worker claims it", async () => {
    await expect(notify({
      kind: "access_code_ready",
      recipient: { userId: "user-1", email: "user@example.com" },
      subjectId: "booking-door-code",
      bookingId: "booking-door-code",
      expiresAt: "2026-09-20T11:00:00.000Z",
      defer: true,
      context: { accessCode: "4821", address: "12 Alder Lane" },
    })).resolves.toMatchObject({ email: "queued" });

    expect(state.inserted[0]).toMatchObject({
      lease_token: null,
      lease_until: null,
      message_snapshot: {
        version: 1,
        message: expect.objectContaining({ body: expect.stringContaining("4821") }),
      },
    });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("lets the database dedupe claim stop a second provider call", async () => {
    const request = {
      kind: "insurance_verified" as const,
      recipient: { userId: "user-1", email: "user@example.com" },
      subjectId: "certificate-1",
      context: {},
    };

    await expect(notify(request)).resolves.toMatchObject({ email: "sent" });
    await expect(notify(request)).resolves.toMatchObject({ email: "duplicate" });
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("queues an opaque privacy-safe push before sending email", async () => {
    state.externalId = `ms_${"a".repeat(43)}`;

    const result = await notify({
      kind: "access_code_ready",
      recipient: { userId: "private-user-id", email: "person@example.com" },
      subjectId: "private-booking-id",
      context: {
        accessCode: "PRIVATE-DOOR-4821",
        address: "PRIVATE 12 Alder Lane",
      },
    });

    expect(result).toEqual({ push: "queued", email: "sent" });
    expect(state.inserted).toHaveLength(2);
    expect(state.inserted[0]).toMatchObject({
      channel: "push",
      dedupe_key: "access_code_ready:private-booking-id:push",
      destination: state.externalId,
      provider_correlation_id: null,
      lease_token: null,
      lease_until: null,
      message_snapshot: {
        version: 1,
        message: {
          subject: "Access details ready",
          body: "Open Minimum Stress securely to view your access details.",
          sms: null,
          push: {
            title: "Access details ready",
            body: "Open Minimum Stress securely to view your access details.",
            url: expect.stringMatching(/^https:\/\//),
          },
        },
      },
    });
    expect(state.inserted[1]).toMatchObject({ channel: "email" });
    const storedPush = state.inserted[0].message_snapshot as {
      message: { html?: unknown; push: unknown };
    };
    expect(storedPush.message).not.toHaveProperty("html");
    expect(JSON.stringify(storedPush))
      .not.toMatch(/PRIVATE-DOOR-4821|PRIVATE 12 Alder Lane|private-user-id/);
    expect(state.sendPush).not.toHaveBeenCalled();
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("uses a stable RFC UUID for OneSignal retries", async () => {
    const key = oneSignalPushIdempotencyKey("booking_confirmed:booking-9:push");
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(oneSignalPushIdempotencyKey("booking_confirmed:booking-9:push")).toBe(key);
    expect(oneSignalPushIdempotencyKey("booking_confirmed:booking-10:push")).not.toBe(key);

    const push = {
      title: "Booking confirmed",
      body: "Your booking is confirmed. Open Minimum Stress for details.",
      url: "https://minimumstress.app/",
    };
    state.rpc.mockResolvedValueOnce({
      data: [{
        id: "notification-push-1",
        kind: "booking_confirmed",
        channel: "push",
        dedupe_key: "booking_confirmed:booking-9:push",
        destination: `ms_${"b".repeat(43)}`,
        message_snapshot: {
          version: 1,
          message: { subject: "Confirmed", body: "Private email body", sms: null, push },
        },
        attempts: 2,
        booking_id: "booking-9",
        expires_at: null,
        lease_token: "worker-push-1",
        provider_correlation_id: null,
      }],
      error: null,
    });

    await expect(retryPending()).resolves.toEqual({ retried: 1, sent: 1, givenUp: 0 });
    expect(state.sendPush).toHaveBeenCalledWith(
      `ms_${"b".repeat(43)}`,
      push,
      { idempotencyKey: key },
    );
    expect(state.rpc).toHaveBeenLastCalledWith(
      "record_notification_acceptance",
      expect.objectContaining({
        p_dedupe_key: "booking_confirmed:booking-9:push",
        p_provider_message_id: "push_123",
      }),
    );
  });

  it("closes a 200/no-id push as unsubscribed without creating a failure", async () => {
    state.rpc.mockResolvedValueOnce({
      data: [{
        id: "notification-push-2",
        kind: "new_message",
        channel: "push",
        dedupe_key: "new_message:thread-1:push",
        destination: `ms_${"c".repeat(43)}`,
        message_snapshot: {
          version: 1,
          message: {
            subject: "New message",
            body: "Private email body",
            sms: null,
            push: {
              title: "New message",
              body: "You have a new message in Minimum Stress.",
              url: "https://minimumstress.app/",
            },
          },
        },
        attempts: 1,
        booking_id: null,
        expires_at: null,
        lease_token: "worker-push-2",
        provider_correlation_id: null,
      }],
      error: null,
    });
    state.sendPush.mockResolvedValueOnce({
      status: "skipped",
      reason: "no subscribed push destination",
    });

    await expect(retryPending()).resolves.toEqual({ retried: 1, sent: 0, givenUp: 0 });
    expect(state.updates.at(-1)).toMatchObject({
      provider_status: "unsubscribed",
      sent_at: expect.any(String),
      destination: null,
      message_snapshot: null,
      last_error: null,
      lease_token: null,
      lease_until: null,
    });
  });

  it("retries the immutable snapshot instead of rebuilding current booking facts", async () => {
    const immutable = {
      subject: "Refund approved",
      body: "Exactly $31.25 is on its way back.",
      sms: null,
    };
    state.rpc.mockResolvedValueOnce({
      data: [{
        id: "notification-1",
        kind: "refund_decided",
        channel: "email",
        dedupe_key: "refund_decided:refund-9:email",
        destination: "person@example.com",
        message_snapshot: { version: 1, message: immutable },
        attempts: 2,
        booking_id: "booking-now-has-different-money",
        expires_at: null,
        lease_token: "worker-1",
        provider_correlation_id: providerCorrelationId("refund_decided:refund-9:email"),
      }],
      error: null,
    });

    const outcome = await retryPending();

    expect(outcome).toEqual({ retried: 1, sent: 1, givenUp: 0 });
    expect(state.sendEmail).toHaveBeenCalledWith(
      "person@example.com",
      immutable,
      {
        idempotencyKey: providerIdempotencyKey("refund_decided:refund-9:email"),
        correlationId: providerCorrelationId("refund_decided:refund-9:email"),
      },
    );
  });

  it("fails closed when provider acceptance cannot be recorded", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });

    await expect(notify({
      kind: "insurance_verified",
      recipient: { userId: "user-1", email: "user@example.com" },
      subjectId: "certificate-rpc-failure",
      context: {},
    })).rejects.toThrow("Could not record provider acceptance");

    expect(state.updates).toHaveLength(0);
  });

  it("marks a permanently rejected retry terminal", async () => {
    state.rpc.mockResolvedValueOnce({
      data: [{
        id: "notification-2",
        kind: "payout_failed",
        channel: "email",
        dedupe_key: "payout_failed:po_1:email",
        destination: "host@example.com",
        message_snapshot: {
          version: 1,
          message: { subject: "Payout failed", body: "Update details", sms: null },
        },
        attempts: 2,
        booking_id: null,
        expires_at: null,
        lease_token: "worker-2",
        provider_correlation_id: providerCorrelationId("payout_failed:po_1:email"),
      }],
      error: null,
    });
    state.sendEmail.mockResolvedValueOnce({ status: "dropped", reason: "email 422" });

    await expect(retryPending()).resolves.toEqual({ retried: 1, sent: 0, givenUp: 1 });
    expect(state.updates.at(-1)).toMatchObject({
      provider_status: "failed",
      last_error: "email 422",
      dropped_at: expect.any(String),
      lease_token: null,
    });
  });
});
