import { describe, expect, it } from "vitest";

import {
  MIN_LEAD_HOURS,
  REQUEST_EXPIRY_HOURS,
  canAnswer,
  expiresAt,
  explainApprovalRefusal,
  hasExpired,
  minutesLeft,
  tooCloseToRequest,
} from "./booking-approval";

/**
 * The clock, from both ends.
 *
 * Two deadlines run at once — a day from the request, and two hours before the
 * session — and every case here is about which of them bites first. That is
 * the part a reader gets wrong, and the part that decides whether somebody
 * turns up at a studio that never agreed to let them in.
 */

const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.UTC(2026, 7, 17, 9) + hours * HOUR);

const request = (requestedHours: number, startHours: number) => ({
  approvalState: "pending" as const,
  requestedAt: at(requestedHours),
  startsAt: at(startHours),
});

describe("a request made well ahead", () => {
  /** Three weeks out: the day is what runs out, not the session. */
  const far = request(0, 24 * 21);

  it("expires a day after it was made", () => {
    expect(expiresAt(far)).toEqual(at(REQUEST_EXPIRY_HOURS));
  });

  it("can still be answered an hour before that", () => {
    expect(canAnswer(far, at(REQUEST_EXPIRY_HOURS - 1))).toBeNull();
  });

  it("cannot be answered a minute after it", () => {
    expect(canAnswer(far, at(REQUEST_EXPIRY_HOURS + 0.02))).toBe("already_expired");
  });

  /*
   * The sweep runs on a schedule and a host looking at their phone does not.
   * If this went by the stored state, a host could accept a request that the
   * cron was about to expire, and the guest would be charged for a booking the
   * system had already given up on.
   */
  it("is refused on the clock rather than on whether the sweep has run", () => {
    expect(far.approvalState).toBe("pending");
    expect(hasExpired(far, at(REQUEST_EXPIRY_HOURS + 1))).toBe(true);
  });
});

describe("a request for tomorrow morning", () => {
  /** Made at 9am for a session eight hours later. The session bites first. */
  const soon = request(0, 8);

  it("expires two hours before the session, not a day later", () => {
    expect(expiresAt(soon)).toEqual(at(8 - MIN_LEAD_HOURS));
  });

  it("is refused inside that window, and says the session is the reason", () => {
    expect(canAnswer(soon, at(8 - 1))).toBe("session_too_close");
  });

  it("is still answerable just outside it", () => {
    expect(canAnswer(soon, at(8 - MIN_LEAD_HOURS - 0.5))).toBeNull();
  });
});

describe("a request nobody answered until the session had started", () => {
  it("says so, rather than reporting it as expired", () => {
    expect(canAnswer(request(0, 5), at(6))).toBe("session_passed");
  });
});

describe("a request that was already answered", () => {
  it("cannot be answered again", () => {
    for (const approvalState of ["approved", "declined", "expired", "not_required"] as const) {
      expect(canAnswer({ ...request(0, 48), approvalState }, at(1)), approvalState).toBe(
        "not_pending",
      );
    }
  });

  /** Only a pending request expires. An approved one is a booking. */
  it("does not expire", () => {
    expect(hasExpired({ ...request(0, 48), approvalState: "approved" }, at(999))).toBe(false);
  });
});

describe("how long is left", () => {
  it("counts down in whole minutes", () => {
    expect(minutesLeft(request(0, 24 * 7), at(REQUEST_EXPIRY_HOURS - 2))).toBe(120);
  });

  it("is zero once it is gone rather than a negative number", () => {
    expect(minutesLeft(request(0, 24 * 7), at(REQUEST_EXPIRY_HOURS + 5))).toBe(0);
  });
});

describe("asking in the first place", () => {
  /*
   * Offering a request forty minutes before the hour offers something that can
   * only expire — there is no window left for anybody to answer in.
   */
  it("is refused when the session is closer than a host could answer", () => {
    expect(tooCloseToRequest(at(1), at(0))).toBe(true);
    expect(tooCloseToRequest(at(MIN_LEAD_HOURS + 0.5), at(0))).toBe(false);
  });
});

describe("what a host is told", () => {
  it("gives every refusal a sentence", () => {
    for (const reason of [
      "not_pending",
      "already_expired",
      "session_too_close",
      "session_passed",
    ] as const) {
      expect(explainApprovalRefusal(reason).length, reason).toBeGreaterThan(20);
    }
  });
});

/**
 * The one constant that is load-bearing against something outside this file.
 *
 * The hold is captured when the host approves, and a card authorisation dies
 * after seven days. An expiry window anywhere near that would mean approving a
 * request whose money had quietly gone — the row would say confirmed and the
 * capture would fail.
 */
describe("the expiry window against Stripe's", () => {
  it("stays well inside the seven days an authorisation lives for", () => {
    expect(REQUEST_EXPIRY_HOURS).toBeLessThanOrEqual(48);
  });
});
