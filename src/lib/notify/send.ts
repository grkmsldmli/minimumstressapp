import { supabaseAdmin } from "../supabase/server";
import { type Message, type MessageContext, type NotificationKind, render } from "./messages";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "./transports";

/**
 * Claiming a message, sending it, and recording what happened.
 *
 * The order is claim → send → mark, and it is the order that does the work.
 * Claiming first means a concurrent or retried run collides on the unique key
 * and stops; if the claim were last, two runs could both send and only then
 * discover they had raced.
 */

export interface Recipient {
  userId: string;
  name?: string;
  email: string | null;
  /** Only ever populated when the number has been verified and opted in. */
  phone?: string | null;
}

export interface NotifyRequest {
  kind: NotificationKind;
  recipient: Recipient;
  context: MessageContext;
  /** What this message is about. Two messages about the same thing collide. */
  subjectId: string;
  bookingId?: string;
}

export type NotifyOutcome = "sent" | "skipped" | "duplicate" | "failed";

/**
 * Sends one message on every channel it belongs on.
 *
 * Returns the outcome per channel rather than a single verdict, because
 * "the SMS bounced but the email arrived" is a materially different situation
 * from either channel alone and the caller may want to say so.
 */
export async function notify(
  request: NotifyRequest,
): Promise<Partial<Record<"email" | "sms", NotifyOutcome>>> {
  const message = render(request.kind, { name: request.recipient.name, ...request.context });
  const outcome: Partial<Record<"email" | "sms", NotifyOutcome>> = {};

  if (request.recipient.email) {
    outcome.email = await deliver(request, "email", request.recipient.email, () =>
      sendEmail(request.recipient.email!, message),
    );
  }

  // An SMS only happens when the message is one of the two urgent kinds *and*
  // there is a verified number to send it to. The kind decides, not the caller.
  if (message.sms && request.recipient.phone) {
    outcome.sms = await deliver(request, "sms", request.recipient.phone, () =>
      sendSms(request.recipient.phone!, message.sms!),
    );
  }

  return outcome;
}

async function deliver(
  request: NotifyRequest,
  channel: "email" | "sms",
  destination: string,
  send: () => Promise<import("./transports").SendResult>,
): Promise<NotifyOutcome> {
  const admin = supabaseAdmin();
  const dedupeKey = `${request.kind}:${request.subjectId}:${channel}`;

  const configured = channel === "email" ? emailConfigured() : smsConfigured();
  if (!configured) {
    /**
     * No provider yet.
     *
     * Logged and skipped rather than queued. A row claimed now would be
     * retried the moment a key is added, and the first thing a new Resend
     * account would do is deliver a backlog of stale messages about sessions
     * that already happened.
     */
    console.warn(`Notification skipped — no ${channel} provider: ${dedupeKey}`);
    return "skipped";
  }

  // Claim. A duplicate key here is the mechanism working, not an error.
  const { error: claimError } = await admin.from("notifications").insert({
    user_id: request.recipient.userId,
    booking_id: request.bookingId ?? null,
    kind: request.kind,
    channel,
    dedupe_key: dedupeKey,
    attempts: 1,
  });

  if (claimError) {
    if (claimError.code === "23505") return "duplicate";
    console.error(`Could not claim notification ${dedupeKey}:`, claimError);
    return "failed";
  }

  const result = await send();

  if (result.status === "sent") {
    await admin
      .from("notifications")
      .update({ sent_at: new Date().toISOString() })
      .eq("dedupe_key", dedupeKey);
    return "sent";
  }

  const patch =
    result.status === "dropped"
      ? { dropped_at: new Date().toISOString(), last_error: result.reason }
      : { last_error: result.reason };

  await admin.from("notifications").update(patch).eq("dedupe_key", dedupeKey);

  console.error(`Notification ${result.status} — ${dedupeKey}: ${result.reason}`);
  return "failed";
}

/**
 * Retries the messages that failed for a reason that might have passed.
 *
 * Run from the cron job. Only touches rows that were claimed but never sent or
 * dropped, so a message whose provider was briefly down goes out on the next
 * pass instead of being lost with the request that created it.
 *
 * `renderFor` is supplied by the caller because rebuilding a message needs the
 * booking it is about, and this module deliberately knows nothing about
 * bookings.
 */
export async function retryPending(
  renderFor: (row: PendingNotification) => Promise<{ to: string; message: Message } | null>,
  limit = 50,
): Promise<{ retried: number; sent: number; givenUp: number }> {
  const admin = supabaseAdmin();

  const { data: pending, error } = await admin
    .from("notifications")
    .select("id, kind, channel, user_id, booking_id, dedupe_key, attempts")
    .is("sent_at", null)
    .is("dropped_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(limit);

  if (error) throw error;
  if (!pending?.length) return { retried: 0, sent: 0, givenUp: 0 };

  let sent = 0;
  let givenUp = 0;

  for (const row of pending as PendingNotification[]) {
    const rebuilt = await renderFor(row);

    if (!rebuilt) {
      // The booking or the recipient is gone. Nothing to send, ever.
      await admin
        .from("notifications")
        .update({ dropped_at: new Date().toISOString(), last_error: "subject no longer exists" })
        .eq("id", row.id);
      givenUp += 1;
      continue;
    }

    // An sms row can only exist for a kind that has SMS text, but the type
    // does not know that, so a missing one is treated as nothing to retry.
    if (row.channel === "sms" && !rebuilt.message.sms) {
      await admin
        .from("notifications")
        .update({ dropped_at: new Date().toISOString(), last_error: "no sms text for this kind" })
        .eq("id", row.id);
      givenUp += 1;
      continue;
    }

    const result =
      row.channel === "email"
        ? await sendEmail(rebuilt.to, rebuilt.message)
        : await sendSms(rebuilt.to, rebuilt.message.sms!);

    const attempts = row.attempts + 1;

    if (result.status === "sent") {
      await admin
        .from("notifications")
        .update({ sent_at: new Date().toISOString(), attempts })
        .eq("id", row.id);
      sent += 1;
      continue;
    }

    // Given up on either because the provider says it will never work, or
    // because we have now asked enough times to stop asking.
    const exhausted = result.status === "dropped" || attempts >= MAX_ATTEMPTS;
    if (exhausted) givenUp += 1;

    await admin
      .from("notifications")
      .update({
        attempts,
        last_error: result.reason,
        ...(exhausted ? { dropped_at: new Date().toISOString() } : {}),
      })
      .eq("id", row.id);
  }

  return { retried: pending.length, sent, givenUp };
}

/**
 * Five, against a job that runs daily on the current plan.
 *
 * Every message here is about a session at a particular time, so a delivery on
 * the sixth day is not a late success — it is a confusing message about
 * something that already happened.
 */
export const MAX_ATTEMPTS = 5;

export interface PendingNotification {
  id: string;
  kind: NotificationKind;
  channel: "email" | "sms";
  user_id: string;
  booking_id: string | null;
  dedupe_key: string;
  attempts: number;
}
