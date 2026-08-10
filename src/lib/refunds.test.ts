import { describe, expect, it } from "vitest";

import {
  REFUND_QUESTIONS,
  REFUND_WINDOW_DAYS,
  REQUESTS_BEFORE_REVIEW,
  type RefundContext,
  canRequestRefund,
  questionFor,
  refundCents,
  routeRefund,
} from "./refunds";

const NOW = new Date("2026-08-10T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

const ask = (over: Partial<RefundContext> = {}): RefundContext => ({
  reason: "not_as_described",
  sessionStart: hours(-2),
  now: NOW,
  recentRequests: 0,
  hostAlreadyPaid: false,
  ...over,
});

describe("nothing pays out on one side's account of events", () => {
  /**
   * The whole anti-abuse design, asserted as an absence.
   *
   * Every reason that blames the host must reach either the host or a person.
   * A branch that refunds on the practitioner's word alone is the branch that
   * gets farmed, and the host who did nothing wrong is the one who pays for it.
   */
  it("never decides an accusation by itself", () => {
    const accusing = REFUND_QUESTIONS.filter((q) => q.accusesHost);
    expect(accusing.length).toBeGreaterThan(3);

    for (const question of accusing) {
      const route = routeRefund(ask({ reason: question.reason }));
      expect(route.kind, question.reason).not.toBe("decided");
    }
  });

  it("asks the studio before anything that costs them", () => {
    const route = routeRefund(ask({ reason: "no_access" }));
    expect(route.kind).toBe("ask_host");
  });
});

describe("safety is not weighed against anything", () => {
  it("goes to a person even from somebody who asks constantly", () => {
    const route = routeRefund(ask({ reason: "unsafe", recentRequests: 99 }));

    expect(route).toEqual({
      kind: "staff",
      priority: "safety",
      because: expect.any(String),
    });
  });

  /** Late, and still a person reads it. A stale report is still a report. */
  it("is not closed by the window", () => {
    const route = routeRefund(
      ask({ reason: "unsafe", sessionStart: hours(-24 * (REFUND_WINDOW_DAYS + 30)) }),
    );
    expect(route.kind).toBe("staff");
  });
});

describe("changing your mind", () => {
  /**
   * The one reason that needs nobody else's story, and the one the 24-hour rule
   * already answers. Said plainly rather than parked in a queue where it looks
   * like it might turn into a yes.
   */
  it("is refused inside 24 hours, and says why", () => {
    const route = routeRefund(ask({ reason: "changed_plans", sessionStart: hours(6) }));

    expect(route).toMatchObject({ kind: "decided", outcome: "none" });
    if (route.kind === "decided") expect(route.because).toMatch(/could not sell it again/);
  });

  it("is a normal cancellation further out", () => {
    const route = routeRefund(ask({ reason: "changed_plans", sessionStart: hours(48) }));
    expect(route).toMatchObject({ kind: "decided", outcome: "full" });
  });
});

describe("the window", () => {
  it("closes after a week", () => {
    const route = routeRefund(ask({ sessionStart: hours(-24 * (REFUND_WINDOW_DAYS + 1)) }));
    expect(route).toMatchObject({ kind: "decided", outcome: "none" });
  });

  it("is open on the last day", () => {
    const route = routeRefund(ask({ sessionStart: hours(-24 * REFUND_WINDOW_DAYS + 1) }));
    expect(route.kind).not.toBe("decided");
  });
});

describe("somebody who asks often", () => {
  /**
   * A count is a reason to look, not a reason to refuse. Three genuinely bad
   * sessions is possible, and turning down the fourth on arithmetic punishes
   * somebody for their luck rather than their conduct.
   */
  it("gets a person rather than a refusal", () => {
    const route = routeRefund(ask({ recentRequests: REQUESTS_BEFORE_REVIEW }));

    expect(route.kind).toBe("staff");
    if (route.kind === "staff") {
      expect(route.priority).toBe("normal");
      expect(route.because).toMatch(/pattern/);
    }
  });

  it("is treated normally below the line", () => {
    const route = routeRefund(ask({ recentRequests: REQUESTS_BEFORE_REVIEW - 1 }));
    expect(route.kind).toBe("ask_host");
  });
});

describe("what each outcome pays", () => {
  const booking = { totalCents: 4200, hostRateCents: 3500 };

  it("gives everything back on a full refund", () => {
    expect(refundCents("full", booking)).toBe(4200);
  });

  /**
   * The honest middle. The host set the hour aside and lost the chance to sell
   * it, which is real whether or not the session went well — so what comes
   * back is our own cut, the part we can return without charging somebody else
   * for a decision they had no part in.
   */
  it("returns only our own cut on the middle outcome", () => {
    expect(refundCents("our_fee", booking)).toBe(700);
    expect(refundCents("our_fee", booking)).toBe(booking.totalCents - booking.hostRateCents);
  });

  it("never returns more than was paid", () => {
    for (const outcome of ["full", "our_fee", "none"] as const) {
      expect(refundCents(outcome, booking)).toBeLessThanOrEqual(booking.totalCents);
      expect(refundCents(outcome, booking)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("which bookings can be asked about", () => {
  const paid = { status: "completed", paidCents: 4200, refundedCents: 0 };

  it("allows a session that happened and was paid for", () => {
    expect(canRequestRefund(paid)).toBe(true);
  });

  it("refuses one that was never charged", () => {
    expect(canRequestRefund({ ...paid, paidCents: 0 })).toBe(false);
  });

  /** Nothing left to give back, so a request could only ever end in no. */
  it("refuses one already refunded in full", () => {
    expect(canRequestRefund({ ...paid, refundedCents: 4200 })).toBe(false);
  });

  it("allows a partially refunded one", () => {
    expect(canRequestRefund({ ...paid, refundedCents: 700 })).toBe(true);
  });

  it("refuses one that has not happened yet", () => {
    expect(canRequestRefund({ ...paid, status: "upcoming" })).toBe(false);
  });
});

describe("the questions themselves", () => {
  it("asks something real after every reason", () => {
    for (const question of REFUND_QUESTIONS) {
      expect(question.prompt.length, question.reason).toBeGreaterThan(15);
      expect(question.label.length, question.reason).toBeGreaterThan(5);
    }
  });

  /** A claim about a room is worth a photograph; a change of plan is not. */
  it("asks for a photo only where one would settle it", () => {
    expect(questionFor("not_as_described").wantsPhoto).toBe(true);
    expect(questionFor("changed_plans").wantsPhoto).toBe(false);
  });

  it("knows which reasons point at the host", () => {
    expect(questionFor("changed_plans").accusesHost).toBe(false);
    expect(questionFor("other").accusesHost).toBe(false);
    expect(questionFor("no_access").accusesHost).toBe(true);
  });
});
