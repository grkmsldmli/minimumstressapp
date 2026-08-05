import { describe, expect, it } from "vitest";

import {
  INSTANT_PAYOUT_MINIMUM_CENTS,
  PAYOUT_DELAY_DAYS,
  canAcceptBookings,
  describeSpeed,
  instantPayoutFeeCents,
  netPayoutCents,
  payoutStatus,
} from "./payouts";

describe("standard payouts leave the rate alone", () => {
  it("pays the full amount, whatever it is", () => {
    for (const cents of [500, 2200, 4500, 12_000, 99_999]) {
      expect(netPayoutCents(cents, "standard")).toBe(cents);
    }
  });

  it("says when the money arrives without claiming it is free of charge", () => {
    // "Free" invites the question of what the other one costs. Saying when it
    // lands answers the question a host actually has.
    const { arrival, costLine } = describeSpeed("standard", 4500);

    expect(arrival).toContain(String(PAYOUT_DELAY_DAYS));
    expect(costLine).toBeNull();
  });
});

describe("instant payouts, priced honestly", () => {
  it("charges 1.5% on a normal session", () => {
    // $45.00 -> 68c, so the host receives $44.32.
    expect(instantPayoutFeeCents(4500)).toBe(68);
    expect(netPayoutCents(4500, "instant")).toBe(4432);
  });

  it("applies the minimum on small amounts, where the percentage would not cover it", () => {
    expect(instantPayoutFeeCents(1000)).toBe(INSTANT_PAYOUT_MINIMUM_CENTS);
    expect(instantPayoutFeeCents(100)).toBe(INSTANT_PAYOUT_MINIMUM_CENTS);
  });

  it("scales past the minimum on larger ones", () => {
    expect(instantPayoutFeeCents(20_000)).toBe(300);
    expect(netPayoutCents(20_000, "instant")).toBe(19_700);
  });

  it("never returns a negative payout", () => {
    expect(netPayoutCents(10, "instant")).toBe(0);
    expect(netPayoutCents(0, "instant")).toBe(0);
  });

  it("quotes the actual figures rather than calling it a small fee", () => {
    // A host choosing this should see what they will receive, not an adjective.
    const { costLine } = describeSpeed("instant", 4500);

    expect(costLine).toContain("$0.68");
    expect(costLine).toContain("$44.32");
    expect(costLine).not.toMatch(/small fee/i);
  });

  it("still explains the cost when there is no example amount to hand", () => {
    const { costLine } = describeSpeed("instant", 0);

    expect(costLine).toContain("1.5%");
    expect(costLine).toContain("$0.50");
  });
});

describe("whether a host can be paid at all", () => {
  const account = {
    hasAccount: true,
    chargesEnabled: true,
    payoutsEnabled: true,
    hasOverdueRequirements: false,
  };

  it("is ready only when Stripe reports both charges and payouts enabled", () => {
    expect(payoutStatus(account)).toBe("ready");
    // Charges without payouts means money can be taken and never reach them,
    // which is worse than refusing the booking.
    expect(payoutStatus({ ...account, payoutsEnabled: false })).toBe("in_progress");
    expect(payoutStatus({ ...account, chargesEnabled: false })).toBe("in_progress");
  });

  it("treats an abandoned onboarding as unfinished, not nearly done", () => {
    // The costly mislabel: the account exists, the host thinks they are set
    // up, and every booking on their space is refused in silence.
    expect(payoutStatus({ ...account, chargesEnabled: false, payoutsEnabled: false })).toBe(
      "in_progress",
    );
  });

  it("separates never-started from half-finished", () => {
    expect(payoutStatus({ ...account, hasAccount: false })).toBe("not_started");
  });

  it("flags an account Stripe has restricted", () => {
    expect(payoutStatus({ ...account, hasOverdueRequirements: true })).toBe("restricted");
  });

  it("accepts bookings only when genuinely ready", () => {
    expect(canAcceptBookings("ready")).toBe(true);
    for (const status of ["not_started", "in_progress", "restricted"] as const) {
      expect(canAcceptBookings(status)).toBe(false);
    }
  });
});

/**
 * The host ladder promises "payouts arrive one business day sooner". Before
 * this it was a sentence on a card with nothing behind it.
 */
describe("payout speed earned by standing", () => {
  it("quotes the standard wait to a host with no standing", () => {
    expect(describeSpeed("standard", 4500).arrival).toContain("2 business days");
  });

  it("shortens it by the day they earned, and says it was earned", () => {
    const described = describeSpeed("standard", 4500, 1);
    expect(described.arrival).toContain("1 business day");
    expect(described.arrival).toContain("earned");
  });

  /**
   * The delay is the window in which a card can be disputed after the host has
   * been paid. Removing it entirely moves that risk onto us, so no amount of
   * standing takes it below a day.
   */
  it("never reaches zero, however much standing is thrown at it", () => {
    for (const days of [2, 5, 100]) {
      expect(describeSpeed("standard", 4500, days).arrival).toContain("1 business day");
    }
  });

  it("leaves instant payouts alone — they are already immediate", () => {
    expect(describeSpeed("instant", 4500, 1).arrival).toBe(describeSpeed("instant", 4500).arrival);
  });
});
