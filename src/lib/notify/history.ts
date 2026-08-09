import type { NotificationKind } from "./messages";

/**
 * The messages we sent, as a person would describe them.
 *
 * Not the email body. The stored row keeps a `kind` and no text — deliberately,
 * since the body is rendered from a booking that may since have changed, and
 * replaying it later would show somebody a sentence about a rate or a time
 * that is no longer true.
 *
 * A short label is honest about what it is: a receipt for a message, not the
 * message. Somebody checking whether the door code was sent needs the subject
 * and the time, and has the email itself if they want the words.
 */

export type NotificationState = "sent" | "queued" | "failed";

export interface NotificationEntry {
  id: string;
  kind: string;
  channel: string;
  state: NotificationState;
  sentAt: Date | null;
  createdAt: Date;
  bookingId: string | null;
}

const LABELS: Record<NotificationKind, string> = {
  booking_confirmed: "Your booking was confirmed",
  host_new_booking: "Somebody booked your space",
  access_code_ready: "Your door code was released",
  cancelled_by_practitioner: "A session was cancelled",
  cancelled_by_host: "The host cancelled a session",
  reliability_warning: "A note about late cancellations",
  reliability_suspended: "New bookings were paused",
  payout_failed: "A payout could not be sent",
  safety_escalation: "A safety report was received",
  account_change_requested: "An account change was requested",
};

/**
 * A kind we have no wording for still gets a line.
 *
 * An unknown kind means somebody added one and did not come here, which is a
 * gap in this file rather than a reason to drop a message out of a history —
 * silence would be the app hiding that it had written to somebody.
 */
export function describeNotification(kind: string): string {
  return LABELS[kind as NotificationKind] ?? "A message from Minimum Stress";
}

/** What the state means, said in the words somebody is actually asking in. */
export function explainState(state: NotificationState): string {
  switch (state) {
    case "sent":
      return "Sent";
    case "failed":
      return "Could not be delivered";
    case "queued":
      return "Sending";
  }
}
