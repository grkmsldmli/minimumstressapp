import "server-only";

import { DEFAULT_ONESIGNAL_APP_ID } from "../onesignal/config";
import { type Message, type PushMessage, toHtml } from "./messages";

/**
 * The two ways a message leaves the building.
 *
 * Both report the same three outcomes, because the dispatcher's decision is
 * the same either way: `sent` is done, `retry` goes back in the queue, and
 * `dropped` must never be retried — a wrong address or an unreachable number
 * does not become right by trying again, and retrying it forever is how a
 * queue silently stops making progress on everything behind it.
 */
export type SendResult =
  | { status: "sent"; id: string }
  | { status: "skipped"; reason: string }
  | { status: "retry"; reason: string }
  | { status: "dropped"; reason: string };

export interface EmailSendOptions {
  /** Resend deduplicates repeated requests carrying the same key. */
  idempotencyKey?: string;
  /** Opaque SHA-256 token returned by signed delivery webhooks. */
  correlationId?: string;
}

export interface PushSendOptions {
  /** OneSignal accepts an RFC UUID and deduplicates it for thirty days. */
  idempotencyKey: string;
}

/** Who the mail is from. Overridable so a staging deploy is obviously staging. */
const FROM = process.env.NOTIFY_FROM_EMAIL ?? "Minimum Stress <hello@minimumstress.app>";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Sending plus signed delivery receipts; both are required for green health. */
export function emailWebhookConfigured(): boolean {
  return (
    emailConfigured() &&
    Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim().startsWith("whsec_"))
  );
}

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER),
  );
}

export function pushConfigured(): boolean {
  return Boolean(process.env.ONESIGNAL_REST_API_KEY?.trim() && oneSignalAppId());
}

export async function sendEmail(
  to: string,
  message: Message,
  options: EmailSendOptions = {},
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { status: "retry", reason: "RESEND_API_KEY is not set" };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: message.subject,
        text: message.body,
        html: message.html ?? toHtml(message),
        ...(options.correlationId
          ? { tags: [{ name: "notification_id", value: options.correlationId }] }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // Timeout or connection failure. The message may or may not have been
    // accepted, so this retries — see the note on duplicates in send.ts.
    return { status: "retry", reason: `network: ${(error as Error).message}` };
  }

  return classify(response, "email");
}

export async function sendSms(to: string, text: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { status: "retry", reason: "Twilio credentials are not set" };

  const body = new URLSearchParams({ To: to, Body: text });

  // A Messaging Service is the sender once there is more than one number, and
  // is what the US A2P registration attaches to. A bare number works for a
  // single-number test account.
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (service) body.set("MessagingServiceSid", service);
  else body.set("From", process.env.TWILIO_FROM_NUMBER!);

  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return { status: "retry", reason: `network: ${(error as Error).message}` };
  }

  return classify(response, "sms");
}

/**
 * Send only generic lock-screen copy to an opaque OneSignal external_id.
 * Booking detail stays behind the authenticated app; no user, booking, or
 * destination identifier is placed in the provider-visible payload.
 */
export async function sendPush(
  externalId: string,
  message: PushMessage,
  options: PushSendOptions,
): Promise<SendResult> {
  if (!/^ms_[A-Za-z0-9_-]{43}$/.test(externalId)) {
    return { status: "dropped", reason: "push invalid_external_id" };
  }

  const key = process.env.ONESIGNAL_REST_API_KEY?.trim();
  const appId = oneSignalAppId();
  if (!key || !appId) {
    return { status: "retry", reason: "OneSignal credentials are not set" };
  }

  let response: Response;
  try {
    response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: appId,
        include_aliases: { external_id: [externalId] },
        target_channel: "push",
        headings: { en: message.title },
        contents: { en: message.body },
        // Web opens the authenticated app. Native shells receive only a safe
        // route token and let the SDK click listener navigate in-app, avoiding
        // a second browser window or an unverified deep-link handoff.
        web_url: message.url,
        data: { minimumstress_destination: "notifications" },
        // Use the platform default alert sound/channel so an enabled device
        // gets the ordinary audible/haptic cue for time-sensitive booking
        // activity. The OS still owns quiet modes and per-app notification
        // settings; we never try to bypass them.
        ios_sound: "default",
        android_sound: "default",
        priority: 10,
        idempotency_key: options.idempotencyKey,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Do not retain exception text: a runtime can include request details in
    // it, while the queue only needs to know that this class is retryable.
    return { status: "retry", reason: "push network_error" };
  }

  if (response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { id?: unknown };
    if (typeof payload.id === "string" && payload.id.length > 0) {
      return { status: "sent", id: payload.id };
    }

    // OneSignal deliberately returns 200 with no id when every targeted
    // subscription is absent or unsubscribed. That is terminal, not an outage.
    return { status: "skipped", reason: "no subscribed push destination" };
  }

  return classify(response, "push");
}

function oneSignalAppId(): string {
  return (
    process.env.ONESIGNAL_APP_ID?.trim() ||
    process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID?.trim() ||
    DEFAULT_ONESIGNAL_APP_ID
  );
}

/**
 * Which HTTP failures are worth trying again.
 *
 * 4xx is the provider saying the request itself is wrong — a malformed
 * address, an unsubscribed recipient, a number that cannot receive texts. None
 * of that changes on a second attempt. 429 is the exception: it is a 4xx that
 * explicitly means "later".
 */
async function classify(response: Response, channel: string): Promise<SendResult> {
  if (response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { id?: string; sid?: string };
    return { status: "sent", id: payload.id ?? payload.sid ?? "unknown" };
  }

  // Provider bodies can echo a rejected address or phone number. They are not
  // durable diagnostics: retain only a controlled class and status code.
  if (response.status === 429) {
    return { status: "retry", reason: `${channel} ${response.status}: rate_limited` };
  }
  if (response.status >= 500) {
    return { status: "retry", reason: `${channel} ${response.status}: provider_5xx` };
  }
  return { status: "dropped", reason: `${channel} ${response.status}: provider_4xx` };
}
