import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const RESEND_DELIVERY_EVENT_TYPES = [
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
] as const;

export type ResendDeliveryEventType = (typeof RESEND_DELIVERY_EVENT_TYPES)[number];

export interface ResendDeliveryEvent {
  type: ResendDeliveryEventType;
  createdAt: string;
  emailId: string;
  /** Opaque notification tag set before the provider call. */
  correlationId: string | null;
}

export type ParsedResendWebhook =
  | { kind: "tracked"; event: ResendDeliveryEvent }
  | { kind: "ignored" }
  | { kind: "invalid" };

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const WEBHOOK_SECRET_PREFIX = "whsec_";

/** A deliberately generic error: no secret, signature or body reaches logs. */
export class ResendWebhookVerificationError extends Error {
  constructor() {
    super("Invalid Resend webhook signature");
    this.name = "ResendWebhookVerificationError";
  }
}

/**
 * Verify Resend's Svix signature against the exact bytes that arrived.
 *
 * Resend follows the Standard Webhooks signing format:
 *   HMAC-SHA256(base64(secret), `${id}.${timestamp}.${rawBody}`)
 *
 * The five-minute timestamp window is replay protection. Database uniqueness
 * on `svix-id` supplies the second layer for a valid request retried by Resend.
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: Pick<Headers, "get">,
  secret: string,
  nowMs = Date.now(),
): void {
  const id = headers.get("svix-id");
  const timestampText = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");

  if (!id || !timestampText || !signatureHeader || !secret.startsWith(WEBHOOK_SECRET_PREFIX)) {
    throw new ResendWebhookVerificationError();
  }
  if (!/^\d+$/.test(timestampText)) throw new ResendWebhookVerificationError();

  const timestamp = Number(timestampText);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new ResendWebhookVerificationError();
  }

  const encodedSecret = secret.slice(WEBHOOK_SECRET_PREFIX.length);
  const key = Buffer.from(encodedSecret, "base64");
  const canonicalSecret = key.toString("base64").replace(/=+$/, "");
  if (!key.length || canonicalSecret !== encodedSecret.replace(/=+$/, "")) {
    throw new ResendWebhookVerificationError();
  }

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestampText}.${rawBody}`, "utf8")
    .digest("base64");
  const expectedBytes = Buffer.from(expected, "utf8");

  const matched = signatureHeader.split(/\s+/).some((candidate) => {
    const comma = candidate.indexOf(",");
    if (comma < 0 || candidate.slice(0, comma) !== "v1") return false;
    const received = Buffer.from(candidate.slice(comma + 1), "utf8");
    return received.length === expectedBytes.length && timingSafeEqual(received, expectedBytes);
  });

  if (!matched) throw new ResendWebhookVerificationError();
}

/**
 * Parse only delivery outcomes Command Center and the notification ledger use. A signed event
 * of another type is acknowledged and ignored so adding a Resend subscription
 * later cannot turn an otherwise healthy webhook into a retry loop.
 */
export function parseResendWebhook(rawBody: string): ParsedResendWebhook {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return { kind: "invalid" };
  }

  if (!isRecord(payload) || typeof payload.type !== "string") return { kind: "invalid" };
  if (!isDeliveryEventType(payload.type)) return { kind: "ignored" };
  if (typeof payload.created_at !== "string" || !validTimestamp(payload.created_at)) {
    return { kind: "invalid" };
  }
  if (!isRecord(payload.data) || !nonEmptyBounded(payload.data.email_id, 200)) {
    return { kind: "invalid" };
  }

  return {
    kind: "tracked",
    event: {
      type: payload.type,
      createdAt: new Date(payload.created_at).toISOString(),
      emailId: payload.data.email_id,
      correlationId: parseCorrelationId(payload.data.tags),
    },
  };
}

function parseCorrelationId(tags: unknown): string | null {
  if (!isRecord(tags)) return null;
  const value = tags.notification_id;
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function isDeliveryEventType(value: string): value is ResendDeliveryEventType {
  return (RESEND_DELIVERY_EVENT_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: string): boolean {
  return value.length <= 100 && !Number.isNaN(Date.parse(value));
}

function nonEmptyBounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
