/**
 * The coverage-request lifecycle, in one place so no raw state string is
 * scattered through the code.
 *
 * Stored states (the `work_request_state` enum in migration 0069):
 *   draft      being written, not yet visible to anyone
 *   open       accepting interest
 *   filled     a practitioner has been confirmed
 *   cancelled  the host pulled it
 *   completed  the session happened (see below)
 *   expired    nobody was confirmed before it started (see below)
 *
 * `completed` and `expired` are TIME-derived, not written by a live action:
 * an open request whose start has passed is expired; a filled request whose end
 * has passed is completed. `effectiveState` returns that derived view for
 * display and for the fill guard, while the row keeps its base state until (if
 * ever) a job writes the transition. Keeping both stored and derived in this one
 * module is what stops the two from disagreeing.
 */

import type { WorkInterestState, WorkRequestState } from "../domain";

export const WORK_REQUEST_STATES: readonly WorkRequestState[] = [
  "draft",
  "open",
  "filled",
  "completed",
  "cancelled",
  "expired",
];

export const WORK_INTEREST_STATES: readonly WorkInterestState[] = [
  "interested",
  "confirmed",
  "declined",
  "withdrawn",
];

export interface RequestTiming {
  state: WorkRequestState;
  startsAt: Date;
  endsAt: Date;
}

/** The state a person should see, folding in the passage of time. */
export function effectiveRequestState(r: RequestTiming, now: Date = new Date()): WorkRequestState {
  if (r.state === "open" && now.getTime() >= r.startsAt.getTime()) return "expired";
  if (r.state === "filled" && now.getTime() >= r.endsAt.getTime()) return "completed";
  return r.state;
}

/** A request can still be filled only while it is genuinely open. */
export function isFillable(r: RequestTiming, now: Date = new Date()): boolean {
  return effectiveRequestState(r, now) === "open";
}

/** A practitioner can express interest only on a genuinely open request. */
export function acceptsInterest(r: RequestTiming, now: Date = new Date()): boolean {
  return effectiveRequestState(r, now) === "open";
}

/** The host may still cancel a draft or an open request. */
export function isCancellable(r: RequestTiming, now: Date = new Date()): boolean {
  const s = effectiveRequestState(r, now);
  return s === "draft" || s === "open";
}

/** Short label for a request state. */
export function requestStateLabel(state: WorkRequestState): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "open":
      return "Open";
    case "filled":
      return "Filled";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
  }
}

/** Short label for a practitioner's interest state. */
export function interestStateLabel(state: WorkInterestState): string {
  switch (state) {
    case "interested":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "declined":
      return "Not selected";
    case "withdrawn":
      return "Withdrawn";
  }
}
