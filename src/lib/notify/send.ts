import { createHash, randomUUID } from "node:crypto";

import { oneSignalExternalId } from "../onesignal/identity";
import { supabaseAdmin } from "../supabase/server";
import { type Message, type MessageContext, type NotificationKind, render } from "./messages";
import {
  emailConfigured,
  pushConfigured,
  sendEmail,
  sendPush,
  sendSms,
  smsConfigured,
} from "./transports";

/** A person or an internal team address that can receive a notification. */
export interface Recipient {
  /** Staff destinations deliberately have no profile row. */
  userId: string | null;
  name?: string;
  email: string | null;
  /** Only populated after verification and explicit opt-in. */
  phone?: string | null;
  wantsBookingAlerts?: boolean;
  wantsPayoutAlerts?: boolean;
}

export interface NotifyRequest {
  kind: NotificationKind;
  recipient: Recipient;
  context: MessageContext;
  /** What this message is about. Two messages about the same thing collide. */
  subjectId: string;
  bookingId?: string;
  /** A door code or reminder must become terminal when it is no longer useful. */
  expiresAt?: Date | string;
  /** Queue only; the state-gated worker owns the first provider call. */
  defer?: boolean;
}

export type NotifyOutcome = "queued" | "sent" | "skipped" | "duplicate" | "failed";
type NotificationChannel = "email" | "sms" | "push";

interface MessageSnapshot {
  version: 1;
  message: Message;
}

/**
 * Queue and immediately attempt every channel for one semantic notification.
 *
 * The exact rendered message and destination are recorded before the provider
 * call. A retry therefore cannot turn a host amount into a practitioner total,
 * lose a refund decision, or invent context from a booking that changed later.
 */
export async function notify(
  request: NotifyRequest,
): Promise<Partial<Record<NotificationChannel, NotifyOutcome>>> {
  const message = render(request.kind, { name: request.recipient.name, ...request.context });
  const outcome: Partial<Record<NotificationChannel, NotifyOutcome>> = {};

  // Persist push first and let the state-gated worker send it. If this process
  // stops before email is written, the existing missing-email repair reruns
  // the notifier: push dedupes and email is restored. The reverse ordering can
  // leave a delivered email with no durable push claim after a crash.
  if (request.recipient.userId && message.push) {
    const externalId = oneSignalExternalId(request.recipient.userId);
    // Never retain the richer email/SMS envelope in a push row. Only the
    // privacy-reviewed lock-screen copy belongs in the OneSignal queue.
    const pushOnlyMessage: Message = {
      subject: message.push.title,
      body: message.push.body,
      sms: null,
      push: message.push,
    };
    outcome.push = externalId
      ? await deliver({ ...request, defer: true }, "push", externalId, pushOnlyMessage)
      : "skipped";
  }

  if (request.recipient.email) {
    outcome.email = await deliver(request, "email", request.recipient.email, message);
  }

  if (message.sms && request.recipient.phone) {
    outcome.sms = await deliver(request, "sms", request.recipient.phone, message);
  }

  return outcome;
}

async function deliver(
  request: NotifyRequest,
  channel: NotificationChannel,
  destination: string,
  message: Message,
): Promise<NotifyOutcome> {
  const admin = supabaseAdmin();
  const dedupeKey = `${request.kind}:${request.subjectId}:${channel}`;
  const correlationId = channel === "email" ? providerCorrelationId(dedupeKey) : null;
  const configured =
    channel === "email"
      ? emailConfigured()
      : channel === "sms"
        ? smsConfigured()
        : pushConfigured();
  const now = new Date();
  const dispatchLease = randomUUID();
  const { error: claimError } = await admin.from("notifications").insert({
    user_id: request.recipient.userId,
    booking_id: request.bookingId ?? null,
    kind: request.kind,
    channel,
    dedupe_key: dedupeKey,
    destination,
    message_snapshot: snapshot(message),
    provider_correlation_id: correlationId,
    provider_status: "queued",
    attempts: 1,
    next_attempt_at: now.toISOString(),
    expires_at: normalizeExpiry(request.expiresAt),
    lease_token: request.defer ? null : dispatchLease,
    lease_until: request.defer
      ? null
      : new Date(now.getTime() + 2 * 60_000).toISOString(),
  });

  if (claimError) {
    if (claimError.code === "23505") return "duplicate";
    throw new Error(`Could not persist notification ${dedupeKey}`);
  }

  // Door codes are never sent from the stale result of a prior select. The
  // worker claims them only after the database rechecks booking state and the
  // reveal/end window in the same transaction.
  if (request.defer) return "queued";

  // Provider configuration can arrive after the business event. Preserve the
  // exact envelope now; state and expiry gates keep a future provider key from
  // releasing stale booking or door-code messages as a surprise backlog.
  if (!configured) {
    await admin
      .from("notifications")
      .update({
        last_error: `${channel} provider is not configured`,
        next_attempt_at: nextAttemptAt(1, now),
        lease_token: null,
        lease_until: null,
      })
      .eq("dedupe_key", dedupeKey)
      .eq("lease_token", dispatchLease);
    console.warn(`Notification queued — no ${channel} provider: ${dedupeKey}`);
    return "skipped";
  }

  const result = channel === "email"
    ? await sendEmail(destination, message, {
        idempotencyKey: providerIdempotencyKey(dedupeKey),
        correlationId: correlationId!,
      })
    : channel === "sms"
      ? await sendSms(destination, message.sms!)
      : await sendPush(destination, message.push!, {
          idempotencyKey: oneSignalPushIdempotencyKey(dedupeKey),
        });

  if (result.status === "sent") {
    await recordAcceptance(admin, dedupeKey, result.id, new Date().toISOString(), dispatchLease);
    return "sent";
  }

  if (result.status === "skipped") {
    await finishUnsubscribed(
      admin,
      { dedupe_key: dedupeKey, lease_token: dispatchLease },
      now,
    );
    return "skipped";
  }

  const terminal = result.status === "dropped";
  await admin
    .from("notifications")
    .update({
      provider_status: terminal ? "failed" : "queued",
      last_error: result.reason,
      next_attempt_at: nextAttemptAt(1, now),
      lease_token: null,
      lease_until: null,
      ...(terminal
        ? {
            dropped_at: now.toISOString(),
            failed_at: now.toISOString(),
            destination: null,
            message_snapshot: null,
          }
        : {}),
    })
    .eq("dedupe_key", dedupeKey)
    .eq("lease_token", dispatchLease);

  console.error(`Notification ${result.status} — ${dedupeKey}: ${result.reason}`);
  return "failed";
}

/** Stable, bounded and free of recipient data. Resend retains it for 24 hours. */
export function providerIdempotencyKey(dedupeKey: string): string {
  return `minimum-stress-notification-${providerCorrelationId(dedupeKey)}`;
}

/** Provider-visible correlation that contains no address, name or booking id. */
export function providerCorrelationId(dedupeKey: string): string {
  return createHash("sha256").update(dedupeKey, "utf8").digest("hex");
}

/**
 * Deterministic RFC 9562 UUIDv8 for OneSignal's thirty-day idempotency window.
 * The provider sees no booking id or notification kind, only this digest.
 */
export function oneSignalPushIdempotencyKey(dedupeKey: string): string {
  const bytes = createHash("sha256")
    .update(`minimum-stress:onesignal:notification:v1:${dedupeKey}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function snapshot(message: Message): MessageSnapshot {
  return { version: 1, message };
}

function normalizeExpiry(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Notification expiry must be a date");
  return date.toISOString();
}

function messageFromSnapshot(value: unknown): Message | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as { version?: unknown; message?: unknown };
  if (envelope.version !== 1 || !envelope.message || typeof envelope.message !== "object") {
    return null;
  }

  const message = envelope.message as Partial<Message>;
  const push = message.push;
  if (
    typeof message.subject !== "string" ||
    typeof message.body !== "string" ||
    !(message.sms === null || typeof message.sms === "string") ||
    !(message.html === undefined || typeof message.html === "string") ||
    !(
      push === undefined ||
      push === null ||
      (
        typeof push === "object" &&
        typeof push.title === "string" &&
        push.title.length > 0 &&
        push.title.length <= 100 &&
        typeof push.body === "string" &&
        push.body.length > 0 &&
        push.body.length <= 240 &&
        typeof push.url === "string" &&
        push.url.length > 0 &&
        push.url.length <= 2048
      )
    )
  ) {
    return null;
  }
  return message as Message;
}

/**
 * Retry immutable envelopes claimed atomically by Postgres.
 *
 * A fifteen-minute lease plus `FOR UPDATE SKIP LOCKED` in the migration
 * prevents overlapping cron runs from sending the same SMS. A small bounded
 * pool keeps a full batch comfortably inside that lease. Email also carries
 * the same provider idempotency key on every attempt.
 */
export async function retryPending(
  limit = 20,
): Promise<{ retried: number; sent: number; givenUp: number }> {
  const admin = supabaseAdmin();
  const now = new Date();
  const worker = randomUUID();
  const { data, error } = await admin.rpc("claim_notification_batch", {
    p_worker: worker,
    p_limit: limit,
    p_now: now.toISOString(),
  });

  if (error) throw error;
  const pending = (data ?? []) as PendingNotification[];
  let sent = 0;
  let givenUp = 0;

  let cursor = 0;
  const work = async () => {
    while (cursor < pending.length) {
      const row = pending[cursor++];
      const message = messageFromSnapshot(row.message_snapshot);
      if (
        !message ||
        (row.channel === "sms" && !message.sms) ||
        (row.channel === "push" && !message.push)
      ) {
        await finishFailed(admin, row, "notification payload is invalid", true, now);
        givenUp += 1;
        continue;
      }

      const result = row.channel === "email"
        ? await sendEmail(row.destination, message, {
            idempotencyKey: providerIdempotencyKey(row.dedupe_key),
            correlationId: row.provider_correlation_id ?? undefined,
          })
        : row.channel === "sms"
          ? await sendSms(row.destination, message.sms!)
          : await sendPush(row.destination, message.push!, {
              idempotencyKey: oneSignalPushIdempotencyKey(row.dedupe_key),
            });

      if (result.status === "sent") {
        await recordAcceptance(
          admin,
          row.dedupe_key,
          result.id,
          new Date().toISOString(),
          row.lease_token,
        );
        sent += 1;
        continue;
      }

      if (result.status === "skipped") {
        await finishUnsubscribed(admin, row, now);
        continue;
      }

      const exhausted = result.status === "dropped" || row.attempts >= MAX_ATTEMPTS;
      await finishFailed(admin, row, result.reason, exhausted, now);
      if (exhausted) givenUp += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(5, pending.length) }, () => work()),
  );

  return { retried: pending.length, sent, givenUp };
}

async function recordAcceptance(
  admin: ReturnType<typeof supabaseAdmin>,
  dedupeKey: string,
  providerMessageId: string,
  acceptedAt: string,
  leaseToken: string,
): Promise<void> {
  // The RPC also reconciles a signed provider event that arrived unusually
  // quickly, before this provider id could be written.
  const rpc = (admin as unknown as {
    rpc?: (name: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
  }).rpc;
  const { error } = rpc
    ? await rpc.call(admin, "record_notification_acceptance", {
        p_dedupe_key: dedupeKey,
        p_provider_message_id: providerMessageId ?? "unknown",
        p_accepted_at: acceptedAt,
        p_lease_token: leaseToken,
      })
    : { error: { message: "RPC unavailable" } };

  if (error) throw new Error("Could not record provider acceptance");
}

async function finishFailed(
  admin: ReturnType<typeof supabaseAdmin>,
  row: PendingNotification,
  reason: string,
  terminal: boolean,
  now: Date,
): Promise<void> {
  await admin
    .from("notifications")
    .update({
      provider_status: terminal ? "failed" : "queued",
      last_error: reason,
      next_attempt_at: nextAttemptAt(row.attempts, now),
      lease_token: null,
      lease_until: null,
      ...(terminal
        ? {
            dropped_at: now.toISOString(),
            failed_at: now.toISOString(),
            destination: null,
            message_snapshot: null,
          }
        : {}),
    })
    .eq("id", row.id)
    .eq("lease_token", row.lease_token);
}

async function finishUnsubscribed(
  admin: ReturnType<typeof supabaseAdmin>,
  row: Pick<PendingNotification, "dedupe_key" | "lease_token">,
  now: Date,
): Promise<void> {
  // A 200/no-id means OneSignal found no subscribed device. It is terminal but
  // not a delivery failure, so close the queue row without polluting the
  // operator failure list or retaining the opaque alias and message snapshot.
  await admin
    .from("notifications")
    .update({
      provider_status: "unsubscribed",
      sent_at: now.toISOString(),
      destination: null,
      message_snapshot: null,
      last_error: null,
      lease_token: null,
      lease_until: null,
    })
    .eq("dedupe_key", row.dedupe_key)
    .eq("lease_token", row.lease_token);
}

function nextAttemptAt(attempts: number, from: Date): string {
  const minutes = Math.min(6 * 60, 2 ** Math.max(0, attempts - 1));
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

export const MAX_ATTEMPTS = 12;

export interface PendingNotification {
  id: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  dedupe_key: string;
  destination: string;
  message_snapshot: unknown;
  attempts: number;
  booking_id: string | null;
  expires_at: string | null;
  lease_token: string;
  provider_correlation_id: string | null;
}
