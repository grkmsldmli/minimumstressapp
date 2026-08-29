import type { ApprovalState } from "./booking-approval";
import type { BookingStatus } from "./domain";

/**
 * The booking-lifecycle rule for messaging, on the app's side of the line.
 *
 * The server is authoritative (migration 0063: a message inserts only when the
 * booking is captured and not cancelled). This mirrors that rule from the fields
 * a client already holds, so the composer can be disabled with an honest reason
 * rather than letting a doomed send fail. Reading a thread is never gated here —
 * historical messages stay readable whatever became of the booking.
 *
 * A practitioner's booking carries `approvalState`: a request that is still
 * pending, or was declined or expired, is not yet a confirmed booking and cannot
 * message. A host's booking carries no approvalState — host_bookings() only ever
 * returns captured sessions — so only the cancelled check applies there.
 */
export function bookingAcceptsMessages(input: {
  status: BookingStatus;
  approvalState?: ApprovalState;
}): boolean {
  if (input.status === "cancelled_by_practitioner" || input.status === "cancelled_by_host") {
    return false;
  }
  if (
    input.approvalState !== undefined &&
    input.approvalState !== "not_required" &&
    input.approvalState !== "approved"
  ) {
    return false;
  }
  return true;
}

/** Shown when a booking is not yet confirmed — no payment terminology. */
export const MESSAGING_NOT_YET =
  "Messaging is available after your booking is confirmed.";

/** Shown when a booking is cancelled — readable, but closed to new messages. */
export const MESSAGING_CLOSED =
  "This booking is closed, so it can no longer receive messages. You can still read the conversation.";

/** The reason the composer is disabled, or null when messages can be sent. */
export function messagingDisabledReason(input: {
  status: BookingStatus;
  approvalState?: ApprovalState;
}): string | null {
  if (bookingAcceptsMessages(input)) return null;
  if (input.status === "cancelled_by_practitioner" || input.status === "cancelled_by_host") {
    return MESSAGING_CLOSED;
  }
  return MESSAGING_NOT_YET;
}
