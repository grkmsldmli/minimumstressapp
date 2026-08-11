import { describe, expect, it } from "vitest";

import { CHECKOUT_GRACE_MINUTES, abandonedBefore, isAbandoned, type UnpaidBooking } from "./abandoned";

const NOW = new Date("2026-08-11T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

const booking = (over: Partial<UnpaidBooking> = {}): UnpaidBooking => ({
  id: "b1",
  createdAt: minutesAgo(CHECKOUT_GRACE_MINUTES + 1),
  capturedAt: null,
  status: "upcoming",
  startsAt: new Date("2026-08-13T18:00:00Z"),
  paymentIntentId: "pi_1",
  ...over,
});

describe("what counts as abandoned", () => {
  it("gives up on a checkout nobody came back to", () => {
    expect(isAbandoned(booking(), NOW)).toBe(true);
  });

  it("leaves somebody who is still typing alone", () => {
    expect(isAbandoned(booking({ createdAt: minutesAgo(2) }), NOW)).toBe(false);
  });

  it("waits the whole grace period, not most of it", () => {
    expect(isAbandoned(booking({ createdAt: minutesAgo(CHECKOUT_GRACE_MINUTES - 1) }), NOW)).toBe(
      false,
    );
    expect(isAbandoned(booking({ createdAt: minutesAgo(CHECKOUT_GRACE_MINUTES) }), NOW)).toBe(true);
  });

  /** The single most important negative: this must never touch paid money. */
  it("never touches a booking that was paid for", () => {
    expect(isAbandoned(booking({ capturedAt: minutesAgo(29) }), NOW)).toBe(false);
    expect(isAbandoned(booking({ capturedAt: minutesAgo(1) }), NOW)).toBe(false);
  });

  it("ignores bookings that are already over or cancelled", () => {
    for (const status of ["completed", "cancelled_by_host", "cancelled_by_practitioner"]) {
      expect(isAbandoned(booking({ status }), NOW)).toBe(false);
    }
  });

  /**
   * A booking made minutes before its own session is when somebody is most
   * likely to still be typing. Reaping on nearness rather than on waiting
   * would take the room away from the person about to pay for it.
   */
  it("does not reap early just because the session is close", () => {
    const soon = new Date(NOW.getTime() + 5 * 60_000);
    expect(isAbandoned(booking({ createdAt: minutesAgo(3), startsAt: soon }), NOW)).toBe(false);
    expect(isAbandoned(booking({ startsAt: soon }), NOW)).toBe(true);
  });
});

describe("the cutoff a query can use", () => {
  it("matches the predicate exactly", () => {
    const cutoff = abandonedBefore(NOW);

    // Anything created at or before the cutoff is abandoned; anything after
    // it is not. The two have to agree, or the job reaps rows the rule says
    // it should not.
    expect(isAbandoned(booking({ createdAt: cutoff }), NOW)).toBe(true);
    expect(isAbandoned(booking({ createdAt: new Date(cutoff.getTime() + 1) }), NOW)).toBe(false);
  });
});
