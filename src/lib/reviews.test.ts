import { describe, expect, it } from "vitest";

import {
  BLIND_PERIOD_DAYS,
  ESCALATION_THRESHOLD,
  MIN_REVIEWS_FOR_AVERAGE,
  type Rating,
  REVIEW_WINDOW_DAYS,
  blindPeriodEndsAt,
  canReview,
  escalationPriority,
  isRating,
  isVisible,
  needsEscalation,
  reviewWindowClosesAt,
  summarise,
} from "./reviews";

const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(ms);
const NOON = new Date("2026-08-04T12:00:00Z").getTime();

const session = (endsAt: number, status = "completed") => ({ endsAt: at(endsAt), status });

describe("isRating", () => {
  it.each([1, 2, 3, 4, 5])("accepts %i", (n) => expect(isRating(n)).toBe(true));

  it.each([0, 6, -1, 2.5, "4", null, undefined, NaN])("rejects %s", (n) => {
    expect(isRating(n)).toBe(false);
  });
});

describe("canReview", () => {
  it("allows a review once the session has finished", () => {
    expect(canReview(session(NOON - DAY), false, at(NOON))).toEqual({ allowed: true });
  });

  /** You cannot report on a room you have not been in yet. */
  it("refuses before the session ends", () => {
    expect(canReview(session(NOON + DAY), false, at(NOON))).toEqual({
      allowed: false,
      reason: "session_not_finished",
    });
  });

  it("refuses a second review from the same side", () => {
    expect(canReview(session(NOON - DAY), true, at(NOON))).toEqual({
      allowed: false,
      reason: "already_reviewed",
    });
  });

  it("refuses once the window has closed", () => {
    const ended = NOON - (REVIEW_WINDOW_DAYS + 1) * DAY;
    expect(canReview(session(ended), false, at(NOON))).toEqual({
      allowed: false,
      reason: "window_closed",
    });
  });

  it("still allows one on the last day of the window", () => {
    const ended = NOON - REVIEW_WINDOW_DAYS * DAY;
    expect(canReview(session(ended), false, at(NOON))).toEqual({ allowed: true });
  });

  /**
   * Nobody was in the room, so there is nothing to report. A repeated
   * canceller is handled by the reliability rules instead.
   */
  it.each(["cancelled_by_practitioner", "cancelled_by_host"])("refuses a %s booking", (status) => {
    expect(canReview(session(NOON - DAY, status), false, at(NOON))).toEqual({
      allowed: false,
      reason: "booking_cancelled",
    });
  });

  /** Cancelled is checked first: the booking never happened, so nothing else applies. */
  it("reports the cancellation rather than the unfinished session", () => {
    expect(canReview(session(NOON + DAY, "cancelled_by_host"), false, at(NOON))).toEqual({
      allowed: false,
      reason: "booking_cancelled",
    });
  });
});

describe("isVisible", () => {
  const mine = { submittedAt: at(NOON) };

  it("hides a review while the other side has not written theirs", () => {
    expect(isVisible(mine, null, at(NOON + DAY))).toBe(false);
  });

  /** The moment both exist, neither can be a reply to the other. */
  it("shows both as soon as the second arrives", () => {
    expect(isVisible(mine, { submittedAt: at(NOON + DAY) }, at(NOON + DAY))).toBe(true);
  });

  it("releases it anyway once the blind period runs out", () => {
    expect(isVisible(mine, null, at(NOON + BLIND_PERIOD_DAYS * DAY))).toBe(true);
  });

  it("keeps it sealed until the very end of that period", () => {
    expect(isVisible(mine, null, at(NOON + BLIND_PERIOD_DAYS * DAY - 1))).toBe(false);
  });

  it("shows nothing when nothing was written", () => {
    expect(isVisible(null, { submittedAt: at(NOON) }, at(NOON + 100 * DAY))).toBe(false);
  });
});

describe("needsEscalation", () => {
  it.each([1, 2, 3])("escalates %i stars", (overall) => {
    expect(needsEscalation({ overall: overall as Rating, safetyConcern: false })).toBe(true);
  });

  it.each([4, 5])("leaves %i stars alone", (overall) => {
    expect(needsEscalation({ overall: overall as Rating, safetyConcern: false })).toBe(false);
  });

  /**
   * The case the rating alone would lose. People are reluctant to give a bad
   * score to someone they otherwise liked, so the concern is ticked and the
   * stars stay high — and that report is the one most worth having.
   */
  it("escalates a five-star session with a safety concern", () => {
    expect(needsEscalation({ overall: 5, safetyConcern: true })).toBe(true);
  });

  it("draws the line exactly at the documented threshold", () => {
    expect(needsEscalation({ overall: ESCALATION_THRESHOLD, safetyConcern: false })).toBe(true);
    expect(needsEscalation({ overall: (ESCALATION_THRESHOLD + 1) as Rating, safetyConcern: false })).toBe(
      false,
    );
  });
});

describe("escalationPriority", () => {
  it("puts a stated risk above any number of stars", () => {
    expect(escalationPriority({ overall: 5, safetyConcern: true })).toBe("safety");
    expect(escalationPriority({ overall: 1, safetyConcern: true })).toBe("safety");
  });

  it.each([
    [1, "urgent"],
    [2, "urgent"],
    [3, "review"],
  ])("ranks %i stars as %s", (overall, expected) => {
    expect(escalationPriority({ overall: overall as Rating, safetyConcern: false })).toBe(expected);
  });

  it.each([4, 5])("gives %i stars no priority at all", (overall) => {
    expect(escalationPriority({ overall: overall as Rating, safetyConcern: false })).toBeNull();
  });
});

describe("summarise", () => {
  /**
   * A single three-star review renders as "3.0" beside a competitor's "4.9"
   * and reads as settled fact. "New" is truer, and it stops one bad first
   * night from deciding whether a studio ever gets a second booking.
   */
  it("withholds an average until there are enough reviews", () => {
    expect(summarise([])).toEqual({ average: null, count: 0, isNew: true });
    expect(summarise([3])).toEqual({ average: null, count: 1, isNew: true });
    expect(summarise([5, 5])).toEqual({ average: null, count: 2, isNew: true });
  });

  it("publishes one at the threshold", () => {
    expect(summarise([5, 4, 3])).toEqual({ average: 4, count: 3, isNew: false });
  });

  it("rounds to one decimal, half up", () => {
    // 4.25 exactly — the case that reads as unfair rounded the other way.
    expect(summarise([5, 5, 4, 3]).average).toBe(4.3);
    expect(summarise([4, 4, 5]).average).toBe(4.3);
  });

  it("keeps the count honest even while the average is withheld", () => {
    expect(summarise([1, 1]).count).toBe(2);
  });

  it("agrees with its own documented minimum", () => {
    const justUnder = Array<Rating>(MIN_REVIEWS_FOR_AVERAGE - 1).fill(5);
    const justAt = Array<Rating>(MIN_REVIEWS_FOR_AVERAGE).fill(5);
    expect(summarise(justUnder).isNew).toBe(true);
    expect(summarise(justAt).isNew).toBe(false);
  });
});

describe("deadlines", () => {
  it("reports when a sealed review opens", () => {
    expect(blindPeriodEndsAt(at(NOON))).toEqual(at(NOON + BLIND_PERIOD_DAYS * DAY));
  });

  it("reports when the chance to review runs out", () => {
    expect(reviewWindowClosesAt(at(NOON))).toEqual(at(NOON + REVIEW_WINDOW_DAYS * DAY));
  });

  /** The seal must never outlast the chance to answer it. */
  it("opens a sealed review before the window to reply has closed", () => {
    expect(BLIND_PERIOD_DAYS).toBeLessThan(REVIEW_WINDOW_DAYS);
  });
});
