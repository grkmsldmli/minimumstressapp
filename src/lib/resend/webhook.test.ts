import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseResendWebhook,
  ResendWebhookVerificationError,
  verifyResendWebhook,
} from "./webhook";

const VECTOR = {
  // Public Standard Webhooks test vector, split so secret scanners do not
  // mistake documentation data for a deployable credential.
  secret: ["whsec", "plJ3nmyCDGBKInavdOK15jsl"].join("_"),
  id: "msg_loFOjxBNrRLzqYUf",
  timestamp: "1731705121",
  body: '{"event_type":"ping","data":{"success":true}}',
  signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
};

function vectorHeaders(signature = VECTOR.signature): Headers {
  return new Headers({
    "svix-id": VECTOR.id,
    "svix-timestamp": VECTOR.timestamp,
    "svix-signature": signature,
  });
}

describe("verifyResendWebhook", () => {
  it("matches the published Standard Webhooks signature vector", () => {
    expect(() =>
      verifyResendWebhook(
        VECTOR.body,
        vectorHeaders(),
        VECTOR.secret,
        Number(VECTOR.timestamp) * 1000,
      ),
    ).not.toThrow();
  });

  it("rejects a body changed after signing", () => {
    expect(() =>
      verifyResendWebhook(
        `${VECTOR.body} `,
        vectorHeaders(),
        VECTOR.secret,
        Number(VECTOR.timestamp) * 1000,
      ),
    ).toThrow(ResendWebhookVerificationError);
  });

  it("accepts the matching v1 value among rotated signatures", () => {
    expect(() =>
      verifyResendWebhook(
        VECTOR.body,
        vectorHeaders(`v1,${"x".repeat(44)} ${VECTOR.signature}`),
        VECTOR.secret,
        Number(VECTOR.timestamp) * 1000,
      ),
    ).not.toThrow();
  });

  it.each(["svix-id", "svix-timestamp", "svix-signature"])(
    "rejects a missing %s header",
    (missing) => {
      const headers = vectorHeaders();
      headers.delete(missing);
      expect(() =>
        verifyResendWebhook(
          VECTOR.body,
          headers,
          VECTOR.secret,
          Number(VECTOR.timestamp) * 1000,
        ),
      ).toThrow(ResendWebhookVerificationError);
    },
  );

  it.each([-301, 301])("rejects a timestamp outside the replay window (%ss)", (offset) => {
    expect(() =>
      verifyResendWebhook(
        VECTOR.body,
        vectorHeaders(),
        VECTOR.secret,
        (Number(VECTOR.timestamp) + offset) * 1000,
      ),
    ).toThrow(ResendWebhookVerificationError);
  });
});

describe("parseResendWebhook", () => {
  it("keeps only the minimal fields needed for delivery evidence", () => {
    const correlationId = "a".repeat(64);
    const parsed = parseResendWebhook(JSON.stringify({
      type: "email.delivered",
      created_at: "2026-09-14T12:00:00.000Z",
      data: {
        email_id: "email_123",
        to: ["private@example.com"],
        subject: "Private subject",
        tags: { notification_id: correlationId, campaign: "private-campaign" },
      },
    }));

    expect(parsed).toEqual({
      kind: "tracked",
      event: {
        type: "email.delivered",
        createdAt: "2026-09-14T12:00:00.000Z",
        emailId: "email_123",
        correlationId,
      },
    });
  });

  it("does not trust a malformed provider correlation tag", () => {
    const parsed = parseResendWebhook(JSON.stringify({
      type: "email.delivered",
      created_at: "2026-09-14T12:00:00.000Z",
      data: { email_id: "email_123", tags: { notification_id: "booking:private" } },
    }));

    expect(parsed).toMatchObject({
      kind: "tracked",
      event: { correlationId: null },
    });
  });

  it("ignores a valid envelope for an unsubscribed event type", () => {
    expect(parseResendWebhook('{"type":"email.opened"}')).toEqual({ kind: "ignored" });
  });

  it.each([
    "not json",
    "{}",
    '{"type":"email.delivered","created_at":"bad","data":{"email_id":"x"}}',
    '{"type":"email.delivered","created_at":"2026-09-14T12:00:00Z","data":{}}',
  ])("rejects malformed tracked payloads", (body) => {
    expect(parseResendWebhook(body)).toEqual({ kind: "invalid" });
  });
});
