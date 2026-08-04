import { describe, expect, it } from "vitest";

import {
  bookingMoneyFromQuote,
  quote,
  resolveCancellation,
  type BookingMoney,
} from "../money";
import { BOOKING_PAYMENT_METHODS } from "./payment-methods";
import { hostReceivesCents, planPaymentIntent, settlementFor } from "./payments";

const HOST_ACCOUNT = "acct_test_host";
const META = { bookingId: "bk_1", spaceId: "sp_1", practitionerId: "pr_1" };

const plan = (money: BookingMoney) => planPaymentIntent(money, HOST_ACCOUNT, META);

const priced = (opts: {
  hostRateCents: number;
  isInstant?: boolean;
  isPro?: boolean;
  creditBalanceCents?: number;
}) =>
  bookingMoneyFromQuote(
    quote({
      hostRateCents: opts.hostRateCents,
      isInstant: opts.isInstant ?? false,
      isPro: opts.isPro ?? false,
      creditBalanceCents: opts.creditBalanceCents ?? 0,
    }),
  );

const RATES = [500, 1500, 2250, 3333, 4500, 12000, 99999];
const VARIANTS = [
  { isInstant: false, isPro: false, creditBalanceCents: 0 },
  { isInstant: true, isPro: false, creditBalanceCents: 0 },
  { isInstant: false, isPro: true, creditBalanceCents: 0 },
  { isInstant: true, isPro: true, creditBalanceCents: 0 },
  { isInstant: false, isPro: false, creditBalanceCents: 100_000 },
  { isInstant: true, isPro: true, creditBalanceCents: 100_000 },
];

describe("the host is paid their rate, whatever Stripe is told", () => {
  it("sets an application fee that leaves the destination exactly the host rate", () => {
    for (const hostRateCents of RATES) {
      for (const variant of VARIANTS) {
        const money = priced({ hostRateCents, ...variant });
        const intent = plan(money);

        expect(
          hostReceivesCents(intent),
          `host shorted at ${hostRateCents} with ${JSON.stringify(variant)}`,
        ).toBe(hostRateCents);
      }
    }
  });

  it("authorises the practitioner's all-in total and nothing more", () => {
    const money = priced({ hostRateCents: 4500, isInstant: true });
    const intent = plan(money);

    expect(intent.amount).toBe(5900);
    expect(intent.application_fee_amount).toBe(1400);
    expect(hostReceivesCents(intent)).toBe(4500);
  });

  it("holds rather than charges, so a 24-hour cancellation costs nothing", () => {
    expect(plan(priced({ hostRateCents: 4500 })).capture_method).toBe("manual");
  });

  it("routes the money to the host's own connected account", () => {
    expect(plan(priced({ hostRateCents: 4500 })).transfer_data.destination).toBe(HOST_ACCOUNT);
  });

  it("shrinks our fee, never the host's share, when credit is redeemed", () => {
    const plain = plan(priced({ hostRateCents: 4500 }));
    const credited = plan(priced({ hostRateCents: 4500, creditBalanceCents: 100_000 }));

    expect(credited.amount).toBeLessThan(plain.amount);
    expect(credited.application_fee_amount).toBeLessThan(plain.application_fee_amount);
    expect(hostReceivesCents(credited)).toBe(hostReceivesCents(plain));
  });

  it("refuses to plan a payment that would top up the host from our own balance", () => {
    // Not reachable through quote(), which floors the platform's cut — this
    // guards the path where someone hands planPaymentIntent a hand-built row.
    const impossible: BookingMoney = {
      hostRateCents: 5000,
      serviceFeeCents: 0,
      instantFeeCents: 0,
      proDiscountCents: 0,
      creditAppliedCents: 0,
      totalCents: 4000,
      platformCents: -1000,
    };

    expect(() => plan(impossible)).toThrow(RangeError);
  });

  it("records the breakdown on the intent, so a payout dispute needs only Stripe", () => {
    const intent = plan(priced({ hostRateCents: 4500, isInstant: true }));

    expect(intent.metadata.host_rate_cents).toBe("4500");
    expect(intent.metadata.service_fee_cents).toBe("900");
    expect(intent.metadata.instant_fee_cents).toBe("500");
    expect(intent.metadata.booking_id).toBe("bk_1");
  });
});

describe("what a booking may be paid with", () => {
  it("offers cards and nothing else", () => {
    expect([...BOOKING_PAYMENT_METHODS]).toEqual(["card"]);
  });

  it("offers no method that cannot be held and released", () => {
    // Stripe rejects us_bank_account with capture_method manual outright, so
    // listing it would render a tab that can never complete a booking.
    expect([...BOOKING_PAYMENT_METHODS]).not.toContain("us_bank_account");
  });

  it("offers no buy-now-pay-later", () => {
    // Left to automatic selection Stripe adds these. Consumer financing for an
    // hour in a yoga room is a poor fit, and their refund and dispute handling
    // is nothing like the card hold every cancellation branch assumes.
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

  it("voids an uncaptured hold when the practitioner cancels early", () => {
    expect(settlementFor(outcomeFor("practitioner", 48), 0)).toEqual({ kind: "void" });
  });

  it("captures the full amount inside 24 hours", () => {
    expect(settlementFor(outcomeFor("practitioner", 2), 0)).toEqual({
      kind: "capture",
      amountCents: money.totalCents,
    });
  });

  it("voids rather than refunds when a host cancels before capture", () => {
    expect(settlementFor(outcomeFor("host", 2), 0)).toEqual({ kind: "void" });
  });

  it("refunds the captured amount when a host cancels after capture", () => {
    // The outcome reports chargedCents 0 — correct about what is owed, wrong
    // as a refund amount. Reading it directly would let the practitioner's
    // money quietly stay put.
    const settlement = settlementFor(outcomeFor("host", 0), money.totalCents);

    expect(settlement).toEqual({ kind: "refund", amountCents: money.totalCents });
  });

  it("does nothing rather than capture twice", () => {
    expect(settlementFor(outcomeFor("practitioner", 1), money.totalCents)).toEqual({
      kind: "none",
    });
  });
});
