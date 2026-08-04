import { type Message, toHtml } from "./messages";

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
  | { status: "retry"; reason: string }
  | { status: "dropped"; reason: string };

/** Who the mail is from. Overridable so a staging deploy is obviously staging. */
const FROM = process.env.NOTIFY_FROM_EMAIL ?? "Minimum Stress <hello@minimumstress.app>";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER),
  );
}

export async function sendEmail(to: string, message: Message): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "retry", reason: "RESEND_API_KEY is not set" };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: message.subject,
        text: message.body,
        html: toHtml(message),
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

  const detail = (await response.text().catch(() => "")).slice(0, 300);
  const reason = `${channel} ${response.status}: ${detail}`;

  if (response.status === 429 || response.status >= 500) return { status: "retry", reason };
  return { status: "dropped", reason };
}
