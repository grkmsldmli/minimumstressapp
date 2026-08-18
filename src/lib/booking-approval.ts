/**
 * A booking the host has to say yes to.
 *
 * The room belongs to somebody. Letting them see what a booking is for, who
 * made it and how many are coming — and then decline it — is the control a
 * host actually wants, and it is the one thing an instant marketplace cannot
 * give them. This is the state machine behind that.
 *
 * The money is the part worth explaining.
 *
 * Ordinary bookings are charged outright, and lib/stripe/payments.ts says why:
 * a card hold lasts seven days and somebody can book thirty days ahead, so a
 * hold would expire before the session. A request is different. It only has to
 * survive until the host answers, and that is bounded here at a day — well
 * inside seven. So a request holds the money instead of taking it, and the
 * three ways it can end are honest ones:
 *
 *   approved   the hold is captured, and it becomes an ordinary booking
 *   declined   the hold is released, and nothing reaches the statement
 *   expired    the same, when nobody answered
 *
 * A refund would have been the easy version and the wrong one: money leaving
 * and coming back over a booking that never existed, with the fee and the
 * statement line that go with it.
 */

/**
 * How long a host has.
 *
 * A day, for two reasons that both point at the same number. Longer and the
 * hour is held hostage — a pending request occupies the slot, so nobody else
 * can book it while one person waits on an answer that may never come. Much
 * shorter and a host who lists a room on Friday evening loses bookings for
 * being asleep.
 *
 * It also has to stay well inside the seven days a card authorisation lives
 * for, because the hold is captured on approval and an expired authorisation
 * captures nothing.
 */
export const REQUEST_EXPIRY_HOURS = 24;

/**
 * And when a request stops being answerable because the session is upon us.
 *
 * A host approving forty minutes before the hour leaves somebody no time to
 * get there, and the access details are released on a timer that has already
 * passed. Requests inside this window are not accepted in the first place.
 */
export const MIN_LEAD_HOURS = 2;

/**
 * How long a host's note to the guest can be.
 *
 * Long enough for a real reason — "I have a class in there straight after" —
 * and short enough that it stays a note rather than a conversation. There is a
 * message thread for the rest.
 *
 * Here rather than beside the service that enforces it, because the textarea
 * needs the same number and that file reaches the mail provider.
 */
export const MAX_DECLINE_NOTE = 280;

export type ApprovalState = "not_required" | "pending" | "approved" | "declined" | "expired";

export interface PendingRequest {
  approvalState: ApprovalState;
  /** When the request was made. Expiry counts from here. */
  requestedAt: Date;
  /** The session itself, which is the other deadline. */
  startsAt: Date;
}

export type ApprovalRefusal =
  | "not_pending"
  | "already_expired"
  | "session_too_close"
  | "session_passed";

/** When this request stops waiting, whichever deadline arrives first. */
export function expiresAt(request: PendingRequest): Date {
  const byClock = new Date(request.requestedAt.getTime() + REQUEST_EXPIRY_HOURS * 3_600_000);
  const bySession = new Date(request.startsAt.getTime() - MIN_LEAD_HOURS * 3_600_000);
  return byClock < bySession ? byClock : bySession;
}

export function hasExpired(request: PendingRequest, now: Date): boolean {
  return request.approvalState === "pending" && now >= expiresAt(request);
}

/**
 * Whether a host may answer this request right now.
 *
 * Deliberately refuses an expired one even before the sweep has marked it.
 * The sweep runs on a schedule and a host looking at their phone does not, so
 * the honest answer to "may I still accept this" is computed from the clock
 * rather than from whether a job has caught up.
 */
export function canAnswer(request: PendingRequest, now: Date): ApprovalRefusal | null {
  if (request.approvalState !== "pending") return "not_pending";
  if (now >= request.startsAt) return "session_passed";
  if (hasExpired(request, now)) {
    return now >= new Date(request.startsAt.getTime() - MIN_LEAD_HOURS * 3_600_000)
      ? "session_too_close"
      : "already_expired";
  }
  return null;
}

/** How long the host has left, in whole minutes. Zero once it is gone. */
export function minutesLeft(request: PendingRequest, now: Date): number {
  const left = expiresAt(request).getTime() - now.getTime();
  return left > 0 ? Math.floor(left / 60_000) : 0;
}

export function explainApprovalRefusal(reason: ApprovalRefusal): string {
  switch (reason) {
    case "not_pending":
      return "This request has already been answered.";
    case "already_expired":
      return "This request expired before it was answered, and the hold has been released.";
    case "session_too_close":
      return "This session is too soon to accept now.";
    case "session_passed":
      return "That session has already started.";
  }
}

/**
 * Whether a request may be made at all against this slot.
 *
 * A request arriving an hour before the session cannot be answered in time,
 * and offering it would be offering something that can only expire.
 */
export function tooCloseToRequest(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() < MIN_LEAD_HOURS * 3_600_000;
}
