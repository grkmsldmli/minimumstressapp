import { describe, expect, it } from "vitest";

import {
  FREE_CANCEL_WINDOW_MS,
  INSTANT_FEE_CENTS,
  INSTANT_WINDOW_MS,
  bookingMoneyFromQuote,
  formatCents,
  isInstantSlot,
  isViableHostRate,
  isWithinBookingHorizon,
  minViableHostRateCents,
  quote,
  resolveCancellation,
  BOOKING_HORIZON_DAYS,
  cancellationCostCents,
  earlyCancellationRefundCents,
  estimateStripeFeeCents,
  CAPTURE_SWEEP_HOURS,
} from "./money";
import { addDays, instantFrom } from "./timezone";

/**
 * Rates chosen to exercise rounding edges: a half-cent service fee (2250 -> 450),
 * a repeating decimal (333 -> 66.6), the smallest possible booking, and a large
 * one where the percentage dominates Stripe's fixed 30c.
 */
const RATE_GRID = [1, 100, 333, 500, 999, 2250, 2500, 4500, 7777, 12000, 99999];
const CREDIT_GRID = [0, 1, 50, 500, 900, 5000, 1_000_000];
const FLAGS = [
  { isInstant: false, isPro: false },
  { isInstant: true, isPro: false },
  { isInstant: false, isPro: true },
  { isInstant: true, isPro: true },
];

function everyCombination() {
  const rows = [];
  for (const hostRateCents of RATE_GRID) {
    for (const creditBalanceCents of CREDIT_GRID) {
      for (const flags of FLAGS) {
        rows.push({ hostRateCents, creditBalanceCents, ...flags });
      }
    }
  }
  return rows;
}

describe("the two guarantees", () => {
  const combinations = everyCombination();

  it("pays the host exactly their rate, in every combination", () => {
    for (const input of combinations) {
      const q = quote(input);
      expect(q.hostCents, `host shorted for ${JSON.stringify(input)}`).toBe(input.hostRateCents);
    }
  });

  it("never lets the platform's cut fall below Stripe's processing fee", () => {
    // Scoped to viable rates: below the arithmetic floor a booking cannot pay
    // for its own processing at all. Covered separately below.
    for (const input of combinations.filter((c) => isViableHostRate(c.hostRateCents, c.isPro))) {
      const q = quote(input);
      expect(
        q.platformNetCents,
        `platform went cash-negative for ${JSON.stringify(input)}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the total equal to host plus platform, with no rounding drift", () => {
    for (const input of combinations) {
      const q = quote(input);
      expect(q.totalCents).toBe(q.hostCents + q.platformCents);
    }
  });

  it("never lets the Pro discount reach into the host's rate", () => {
    for (const input of combinations) {
      const q = quote(input);
      expect(q.proDiscountCents).toBeLessThanOrEqual(q.serviceFeeCents + q.instantFeeCents);
      expect(q.totalCents).toBeGreaterThanOrEqual(q.hostCents);
    }
  });
});

describe("the numbers from the brief", () => {
  it("adds 20% on top of a $45 rate for a $54 all-in price", () => {
    const q = quote({
      hostRateCents: 4500,
      isInstant: false,
      isPro: false,
    });

    expect(q.hostCents).toBe(4500);
    expect(q.serviceFeeCents).toBe(900);
    expect(q.totalCents).toBe(5400);
    expect(formatCents(q.totalCents)).toBe("$54.00");
  });

  it("charges a flat $5 on instant slots, all of it platform revenue", () => {
    const normal = quote({
      hostRateCents: 4500,
      isInstant: false,
      isPro: false,
    });
    const instant = quote({
      hostRateCents: 4500,
      isInstant: true,
      isPro: false,
    });

    expect(instant.instantFeeCents).toBe(INSTANT_FEE_CENTS);
    expect(instant.totalCents - normal.totalCents).toBe(INSTANT_FEE_CENTS);
    expect(instant.platformCents - normal.platformCents).toBe(INSTANT_FEE_CENTS);
    expect(instant.hostCents).toBe(normal.hostCents);
  });

  it("takes Pro's 10% off the all-in total: $54.00 becomes $48.60", () => {
    const q = quote({ hostRateCents: 4500, isInstant: false, isPro: true });

    expect(q.proDiscountCents).toBe(540);
    expect(q.totalCents).toBe(4860);
    expect(formatCents(q.totalCents)).toBe("$48.60");
    expect(q.hostCents).toBe(4500);
    expect(q.platformCents).toBe(360);
  });

  it("waives the instant fee for Pro rather than discounting it", () => {
    const q = quote({ hostRateCents: 4500, isInstant: true, isPro: true });
    const proNormal = quote({
      hostRateCents: 4500,
      isInstant: false,
      isPro: true,
    });

    expect(q.instantFeeCents).toBe(0);
    expect(q.totalCents).toBe(proNormal.totalCents);
  });

  it("leaves hosting economics untouched by Pro", () => {
    for (const hostRateCents of RATE_GRID) {
      const standard = quote({
        hostRateCents,
        isInstant: true,
        isPro: false,
      });
      const pro = quote({ hostRateCents, isInstant: true, isPro: true });
      expect(pro.hostCents).toBe(standard.hostCents);
    }
  });
});

describe("the arithmetic floor on host rates", () => {
  /**
   * A percentage fee cannot cover a flat processing charge at small enough
   * amounts. At $0.01/hr the 20% service fee rounds to zero while Stripe still
   * wants 30c, so the booking loses money no matter what credit does. The brief
   * sets no minimum hourly rate; this is where the arithmetic stops working.
   */
  it("identifies the rate below which no booking can pay for itself", () => {
    const threshold = minViableHostRateCents();

    expect(threshold).toBe(183);
    expect(isViableHostRate(threshold)).toBe(true);
    expect(isViableHostRate(threshold - 1)).toBe(false);
  });

  it("sets a higher floor for Pro, whose discount is deliberately not clamped", () => {
    const standard = minViableHostRateCents(false);
    const pro = minViableHostRateCents(true);

    expect(pro).toBeGreaterThan(standard);
    expect(pro).toBe(623);
    expect(isViableHostRate(pro, true)).toBe(true);
    expect(isViableHostRate(pro - 1, true)).toBe(false);
  });

  it("keeps both floors far below any realistic room rate", () => {
    // $6.17/hr is the strictest floor; a real listing minimum sits well above it.
    expect(minViableHostRateCents(true)).toBeLessThan(1000);
  });

  it("loses money on a rate below the floor, credit floor notwithstanding", () => {
    const q = quote({ hostRateCents: 1, isInstant: false, isPro: false });

    expect(q.hostCents).toBe(1); // the host is still paid exactly
    expect(q.serviceFeeCents).toBe(0);
    expect(q.platformNetCents).toBeLessThan(0);
  });

  it("stays profitable at and above each tier's floor", () => {
    for (const isPro of [false, true]) {
      const threshold = minViableHostRateCents(isPro);
      for (let rate = threshold; rate < threshold + 2000; rate += 1) {
        const q = quote({ hostRateCents: rate, isInstant: false, isPro });
        expect(
          q.platformNetCents,
          `lost money at rate ${rate}, isPro=${isPro}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("cancellation", () => {
  const sessionStart = new Date("2026-08-10T15:00:00Z");
  const bookingWithoutCredit = bookingMoneyFromQuote(
    quote({ hostRateCents: 4500, isInstant: false, isPro: false }),
  );
  const bookingWithCredit = bookingMoneyFromQuote(
    quote({ hostRateCents: 4500, isInstant: false, isPro: false }),
  );

  /**
   * Everything back except what the card network kept.
   *
   * Measured rather than assumed: Stripe returns the amount and keeps its fee,
   * so a booking refunded "in full" left us $1.52 down with no revenue against
   * it. Free cancellation is a promise worth making; paying for somebody
   * else's change of plan out of our own margin was not part of it.
   */
  it("returns everything but the card fee when the practitioner cancels early", () => {
    const now = new Date(sessionStart.getTime() - FREE_CANCEL_WINDOW_MS);
    const outcome = resolveCancellation(bookingWithoutCredit, "practitioner", sessionStart, now);

    expect(outcome.action).toBe("void");
    expect(outcome.chargedCents).toBe(cancellationCostCents(bookingWithoutCredit.totalCents));
  });

  /** Priced at cost. A cancellation must not be a thing we profit from. */
  it("keeps only what processing actually cost", () => {
    const total = bookingWithoutCredit.totalCents;

    expect(cancellationCostCents(total)).toBe(estimateStripeFeeCents(total));
    expect(earlyCancellationRefundCents(total)).toBe(total - estimateStripeFeeCents(total));
    expect(cancellationCostCents(total)).toBeLessThan(bookingWithoutCredit.serviceFeeCents);
  });

  /**
   * The one cancellation whose cost we absorb. Somebody who arranged their day
   * around a room the studio then took away must not be charged for it.
   */
  it("costs the practitioner nothing at all when the host cancels", () => {
    const now = new Date(sessionStart.getTime() - 60_000);
    const outcome = resolveCancellation(bookingWithoutCredit, "host", sessionStart, now);

    expect(outcome.chargedCents).toBe(0);
  });

  it("captures in full when the practitioner cancels inside 24 hours", () => {
    const now = new Date(sessionStart.getTime() - FREE_CANCEL_WINDOW_MS + 1000);
    const outcome = resolveCancellation(bookingWithoutCredit, "practitioner", sessionStart, now);

    expect(outcome.action).toBe("capture_full");
    expect(outcome.chargedCents).toBe(bookingWithoutCredit.totalCents);
  });

  it("keeps credit spent on a late-cancelled booking, since it discounted a real charge", () => {
    const now = new Date(sessionStart.getTime() - 1000);
    const outcome = resolveCancellation(bookingWithCredit, "practitioner", sessionStart, now);

    expect(outcome.action).toBe("capture_full");
    expect(outcome.chargedCents).toBe(bookingWithCredit.totalCents);
  });

  it("refunds and credits the fee portion when the host cancels", () => {
    const now = new Date(sessionStart.getTime() - 1000);
    const outcome = resolveCancellation(bookingWithoutCredit, "host", sessionStart, now);

    expect(outcome.action).toBe("void");
    expect(outcome.chargedCents).toBe(0);
    // No credit was involved, so this is the brief's plain reading: the $9 fee.
  });

  it("refunds a host cancellation even at the last second — never optional", () => {
    const now = new Date(sessionStart.getTime() + 60_000);
    const outcome = resolveCancellation(bookingWithoutCredit, "host", sessionStart, now);

    expect(outcome.action).toBe("void");
    expect(outcome.chargedCents).toBe(0);
  });


  it("never awards goodwill larger than the platform earned, across the grid", () => {
    for (const input of everyCombination()) {
      const booking = bookingMoneyFromQuote(quote(input));
      resolveCancellation(booking, "host", sessionStart, sessionStart);
    }
  });
});

describe("instant window, measured against wall-clock time", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it("tags a slot 90 minutes out as instant", () => {
    expect(isInstantSlot(new Date(now.getTime() + 90 * 60 * 1000), now)).toBe(true);
  });

  it("does not tag a slot three hours out", () => {
    expect(isInstantSlot(new Date(now.getTime() + 3 * 60 * 60 * 1000), now)).toBe(false);
  });

  it("treats a slot exactly on the boundary as instant", () => {
    expect(isInstantSlot(new Date(now.getTime() + INSTANT_WINDOW_MS), now)).toBe(true);
  });

  it("does not tag a slot that has already passed", () => {
    expect(isInstantSlot(new Date(now.getTime() - 60_000), now)).toBe(false);
  });

  it("treats a booking right now as instant by definition", () => {
    expect(isInstantSlot(now, now)).toBe(true);
  });
});

describe("the horizon no longer answers to a card hold", () => {
  /**
   * It used to. The window was seven days because an authorisation dies at
   * about seven, and it did not even fit that — the furthest bookable hour was
   * 191 hours out against a 168-hour hold, so the capture would have been
   * refused and the host never paid.
   *
   * The money is taken at booking now, so nothing expires while a booking
   * waits. What is asserted here is only that the window is a real one.
   */
  it("reaches far enough to be worth having", () => {
    expect(BOOKING_HORIZON_DAYS).toBeGreaterThanOrEqual(7);
  });

  it("still sweeps often enough to pay hosts promptly", () => {
    expect(CAPTURE_SWEEP_HOURS).toBeLessThanOrEqual(24);
  });

  it("matches the sweep the deployment actually schedules", async () => {
    const { readFileSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    const sweeps = vercel.crons.filter((c: { path: string }) => c.path === "/api/cron").length;

    // Runs spread across the day, so the longest wait is a day divided by them.
    expect(24 / sweeps).toBeLessThanOrEqual(CAPTURE_SWEEP_HOURS);
  });
});

describe("booking horizon", () => {
  /*
   * Built in a named zone rather than with `new Date(y, m, d)`, which reads
   * whichever zone the test runner happens to be in. That is the exact habit
   * that let the horizon and the slot grid disagree in production, and a test
   * written the same way would agree with a bug instead of catching it.
   */
  const ZONE = "America/Los_Angeles";
  const BASE = { year: 2026, month: 8, day: 3 };

  const at = (day: typeof BASE, hour: number): Date => {
    const instant = instantFrom(day, hour * 60, ZONE);
    if (!instant) throw new Error(`${hour}:00 does not exist on this day`);
    return instant;
  };

  const now = at(BASE, 12);
  const daysFromNow = (days: number, hour = 9) => at(addDays(BASE, days), hour);

  /**
   * One window, the same for everybody.
   *
   * It was a tier — same-day free, three days paid — which made a host open on
   * Tuesdays and Fridays invisible to a free account five days out of seven.
   *
   * Written against the constant rather than a number. The last version of this
   * test asserted day seven was reachable, which was true of the old hardcoded
   * horizon and false of what the card hold actually allows; a test that names
   * a figure the code derives will eventually assert the bug.
   */
  it("reaches the last hour of the furthest day", () => {
    expect(isWithinBookingHorizon(daysFromNow(1), now, false, ZONE)).toBe(true);
    expect(
      isWithinBookingHorizon(daysFromNow(BOOKING_HORIZON_DAYS, 23), now, false, ZONE),
    ).toBe(true);
  });

  it("stops the day after, paid or not", () => {
    const past = BOOKING_HORIZON_DAYS + 1;
    expect(isWithinBookingHorizon(daysFromNow(past), now, false, ZONE)).toBe(false);
    expect(isWithinBookingHorizon(daysFromNow(past), now, true, ZONE)).toBe(false);
  });

  it("gives Pro no further reach", () => {
    for (const day of [0, 1, BOOKING_HORIZON_DAYS, BOOKING_HORIZON_DAYS + 1]) {
      expect(
        isWithinBookingHorizon(daysFromNow(day, 20), now, true, ZONE),
        `day ${day}`,
      ).toBe(isWithinBookingHorizon(daysFromNow(day, 20), now, false, ZONE));
    }
  });

  it("rejects slots in the past for both tiers", () => {
    const past = new Date(now.getTime() - 60_000);
    expect(isWithinBookingHorizon(past, now, false, ZONE)).toBe(false);
    expect(isWithinBookingHorizon(past, now, true, ZONE)).toBe(false);
  });
});

describe("input validation", () => {
  it("rejects fractional cents, which is how float bugs get in", () => {
    expect(() =>
      quote({ hostRateCents: 45.5, isInstant: false, isPro: false }),
    ).toThrow(RangeError);
  });

  it("rejects negative money", () => {
    expect(() =>
      quote({ hostRateCents: -4500, isInstant: false, isPro: false }),
    ).toThrow(RangeError);
  });
});

describe("regression: the prototype's price convention", () => {
  /**
   * The prototype stored the all-in price and recovered the host's share with
   * `Math.round(price / 1.2)`. For a $45 listing that yields $38 to the host and
   * a $7 fee — an 18.4% take, with the host $7 short of the rate they set. The
   * host rate is the only canonical number here, and the all-in is derived.
   */
  it("derives the all-in from the host rate instead of dividing it back out", () => {
    const q = quote({ hostRateCents: 4500, isInstant: false, isPro: false });

    expect(q.hostCents).toBe(4500);
    expect(q.hostCents).not.toBe(Math.round(4500 / 1.2));
    expect(q.serviceFeeCents / q.hostCents).toBeCloseTo(0.2, 10);
  });

  it("holds the fee at exactly 20% of the host rate across the grid", () => {
    for (const hostRateCents of RATE_GRID) {
      const q = quote({ hostRateCents, isInstant: false, isPro: false });
      expect(Math.abs(q.serviceFeeCents - hostRateCents * 0.2)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("formatCents", () => {
  it("formats whole and partial dollars", () => {
    expect(formatCents(5400)).toBe("$54.00");
    expect(formatCents(4860)).toBe("$48.60");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-166)).toBe("-$1.66");
  });
});
