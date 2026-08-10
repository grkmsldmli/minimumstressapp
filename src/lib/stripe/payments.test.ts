import { describe, expect, it } from "vitest";

import {
  bookingMoneyFromQuote,
  quote,
  resolveCancellation,
  type BookingMoney,
} from "../money";
import { BOOKING_PAYMENT_METHODS } from "./payment-methods";
import {
  planHostTransfer,
  planPaymentIntent,
  platformGrossCents,
  settlementFor,
  transferGroupFor,
} from "./payments";

const HOST_ACCOUNT = "acct_test_host";
const META = { bookingId: "bk_1", spaceId: "sp_1", practitionerId: "pr_1" };

const plan = (money: BookingMoney) => planPaymentIntent(money, META);
const CHARGE = "ch_test_1";
const payout = (money: BookingMoney) => planHostTransfer(money, HOST_ACCOUNT, CHARGE, META);

const priced = (opts: { hostRateCents: number; isInstant?: boolean; isPro?: boolean }) =>
  bookingMoneyFromQuote(
    quote({
      hostRateCents: opts.hostRateCents,
      isInstant: opts.isInstant ?? false,
      isPro: opts.isPro ?? false,
    }),
  );

const RATES = [500, 1500, 2250, 3333, 4500, 12000, 99999];
const VARIANTS = [
  { isInstant: false, isPro: false },
  { isInstant: true, isPro: false },
  { isInstant: false, isPro: true },
  { isInstant: true, isPro: true },
];

describe("the host is paid their rate, whatever Stripe is told", () => {
  it("transfers exactly the host rate, at every price and tier", () => {
    for (const hostRateCents of RATES) {
      for (const variant of VARIANTS) {
        const money = priced({ hostRateCents, ...variant });

        expect(
          payout(money).amount,
          `host shorted at ${hostRateCents} with ${JSON.stringify(variant)}`,
        ).toBe(hostRateCents);
      }
    }
  });

  it("charges the practitioner's all-in total and nothing more", () => {
    const money = priced({ hostRateCents: 4500, isInstant: true });

    expect(plan(money).amount).toBe(5900);
    expect(payout(money).amount).toBe(4500);
    expect(platformGrossCents(money)).toBe(1400);
  });

  /**
   * The charge and the transfer are separate objects, and this is what says so.
   *
   * A destination charge pays the host in the same instant the card is taken,
   * which is exactly what makes charging up front unworkable: every refund
   * would then claw money back out of the host's balance, days or weeks after
   * they had watched it arrive.
   */
  it("takes the money now and names no destination", () => {
    const intent = plan(priced({ hostRateCents: 4500 }));

    expect(intent.capture_method).toBe("automatic");
    expect(intent).not.toHaveProperty("transfer_data");
    expect(intent).not.toHaveProperty("application_fee_amount");
  });

  it("routes the payout to the host's own connected account", () => {
    expect(payout(priced({ hostRateCents: 4500 })).destination).toBe(HOST_ACCOUNT);
  });

  /**
   * Funded by the charge rather than by whatever happens to be sitting in our
   * balance. A card charge takes a couple of working days to become available,
   * so a session booked the same morning would otherwise find its own money
   * still settling at the moment the host was due to be paid.
   */
  it("draws the payout from the charge that paid for it", () => {
    expect(payout(priced({ hostRateCents: 4500 })).source_transaction).toBe(CHARGE);
  });

  /** So a payout can be traced back to the charge that funded it, in Stripe. */
  it("ties the charge and the payout together", () => {
    const money = priced({ hostRateCents: 4500 });

    expect(plan(money).transfer_group).toBe(transferGroupFor("bk_1"));
    expect(payout(money).transfer_group).toBe(plan(money).transfer_group);
  });

  it("refuses to plan a payment that would top up the host from our own balance", () => {
    // Not reachable through quote(), which floors the platform's cut — this
    // guards the path where someone hands planPaymentIntent a hand-built row.
    const impossible: BookingMoney = {
      hostRateCents: 5000,
      serviceFeeCents: 0,
      instantFeeCents: 0,
      proDiscountCents: 0,
      totalCents: 4000,
      platformCents: -1000,
    };

    expect(() => plan(impossible)).toThrow(RangeError);
  });

  it("records the breakdown on both sides, so a dispute needs only Stripe", () => {
    const money = priced({ hostRateCents: 4500, isInstant: true });

    for (const object of [plan(money), payout(money)]) {
      expect(object.metadata.host_rate_cents).toBe("4500");
      expect(object.metadata.service_fee_cents).toBe("900");
      expect(object.metadata.instant_fee_cents).toBe("500");
      expect(object.metadata.booking_id).toBe("bk_1");
    }
  });
});

describe("what a booking may be paid with", () => {
  it("offers cards and nothing else", () => {
    expect([...BOOKING_PAYMENT_METHODS]).toEqual(["card"]);
  });

  it("offers no method that cannot be refunded promptly", () => {
    // A bank debit clears slowly and reverses slowly, which is the opposite of
    // what a 24-hour cancellation promise needs.
    expect([...BOOKING_PAYMENT_METHODS]).not.toContain("us_bank_account");
  });

  it("offers no buy-now-pay-later", () => {
    // Left to automatic selection Stripe adds these. Consumer financing for an
    // hour in a yoga room is a poor fit, and their refund and dispute handling
    // is nothing like the plain card refund every cancellation branch assumes.
    for (const financing of ["klarna", "affirm", "afterpay_clearpay", "zip"]) {
      expect([...BOOKING_PAYMENT_METHODS]).not.toContain(financing);
    }
  });
});

describe("settling a cancellation", () => {
  const sessionStart = new Date("2026-08-10T15:00:00Z");
  const money = priced({ hostRateCents: 4500 });

  const outcomeFor = (actor: "practitioner" | "host", hoursBefore: number) =>
    resolveCancellation(
      money,
      actor,
      sessionStart,
      new Date(sessionStart.getTime() - hoursBefore * 3600_000),
    );

  it("refunds in full when the practitioner cancels early", () => {
    expect(settlementFor(outcomeFor("practitioner", 48), money.totalCents)).toEqual({
      kind: "refund",
      amountCents: money.totalCents,
    });
  });

  /** The host kept the hour free, so they are paid as if it had been used. */
  it("keeps the money when the practitioner cancels inside 24 hours", () => {
    expect(settlementFor(outcomeFor("practitioner", 2), money.totalCents)).toEqual({
      kind: "none",
    });
  });

  it("refunds in full when a host cancels, whatever the clock says", () => {
    for (const hoursBefore of [2, 48]) {
      expect(settlementFor(outcomeFor("host", hoursBefore), money.totalCents)).toEqual({
        kind: "refund",
        amountCents: money.totalCents,
      });
    }
  });

  /**
   * A booking abandoned at the card form. There is a payment intent and no
   * money behind it, so refunding against the quoted total would send real
   * money to somebody who never paid any.
   */
  it("closes an unpaid intent rather than refunding it", () => {
    expect(settlementFor(outcomeFor("practitioner", 48), 0)).toEqual({ kind: "abandon" });
    expect(settlementFor(outcomeFor("host", 2), 0)).toEqual({ kind: "abandon" });
  });

  it("never refunds more than was actually paid", () => {
    for (const hoursBefore of [0, 1, 23, 24, 48]) {
      for (const actor of ["practitioner", "host"] as const) {
        const settlement = settlementFor(outcomeFor(actor, hoursBefore), money.totalCents);
        const refunded = settlement.kind === "refund" ? settlement.amountCents : 0;

        expect(refunded, `${actor} at ${hoursBefore}h`).toBeLessThanOrEqual(money.totalCents);
        expect(refunded).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
