import { describe, expect, it } from "vitest";

import {
  planBooking,
  type HostFacts,
  type PractitionerFacts,
  type SpaceFacts,
} from "./booking-plan";
import { INSTANT_FEE_CENTS } from "./money";

/** A Monday at 10:00, with the room open 09:00–17:00 every weekday. */
const NOW = new Date(2026, 7, 3, 10, 0, 0);
const at = (hour: number, dayOffset = 0) =>
  new Date(2026, 7, 3 + dayOffset, hour, 0, 0);

const SPACE: SpaceFacts = {
  id: "sp_1",
  hostId: "host_1",
  hourlyRateCents: 4500,
  bufferMinutes: 0,
  status: "active",
  availability: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  })),
};

const HOST: HostFacts = { stripeAccountId: "acct_1", chargesEnabled: true };
const PRACTITIONER: PractitionerFacts = {
  id: "pr_1",
  isPro: false,
  creditBalanceCents: 0,
  points: 0,
};

const plan = (overrides: Partial<Parameters<typeof planBooking>[0]> = {}) =>
  planBooking({
    space: SPACE,
    host: HOST,
    practitioner: PRACTITIONER,
    takenStarts: [],
    startsAt: at(14),
    now: NOW,
    ...overrides,
  });

describe("the price comes from the space, never the request", () => {
  it("prices from the host's stored rate", () => {
    const result = plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.money.hostRateCents).toBe(4500);
    expect(result.money.totalCents).toBe(5400);
  });

  it("follows the rate when the host changes it, with no input from the caller", () => {
    const result = plan({ space: { ...SPACE, hourlyRateCents: 8000 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.money.hostRateCents).toBe(8000);
    expect(result.money.totalCents).toBe(9600);
  });

  it("takes Pro from the stored profile, so the discount cannot be claimed", () => {
    const standard = plan();
    const pro = plan({ practitioner: { ...PRACTITIONER, isPro: true } });

    expect(standard.ok && standard.money.totalCents).toBe(5400);
    expect(pro.ok && pro.money.totalCents).toBe(4860);
    expect(pro.ok && pro.money.proDiscountCents).toBe(540);
  });

  it("derives instant from the clock, not from a flag on the request", () => {
    const soon = plan({ startsAt: at(11) }); // one hour out
    const later = plan({ startsAt: at(15) }); // five hours out

    expect(soon.ok && soon.isInstant).toBe(true);
    expect(soon.ok && soon.money.instantFeeCents).toBe(INSTANT_FEE_CENTS);
    expect(later.ok && later.isInstant).toBe(false);
    expect(later.ok && later.money.instantFeeCents).toBe(0);
  });

  it("caps credit at the stored balance", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, creditBalanceCents: 300 },
    });

    expect(result.ok && result.money.creditAppliedCents).toBe(300);
  });

  it("pays the host their full rate however the rest of it moves", () => {
    for (const isPro of [false, true]) {
      for (const creditBalanceCents of [0, 500, 100_000]) {
        for (const hour of [11, 14]) {
          const result = plan({
            practitioner: { ...PRACTITIONER, isPro, creditBalanceCents },
            startsAt: at(hour),
          });
          expect(result.ok && result.money.hostRateCents).toBe(4500);
        }
      }
    }
  });
});

describe("a slot has to be one the host actually opened", () => {
  it("refuses an hour outside the day's blocks", () => {
    // 20:00 is still ahead of us but well past the 17:00 close, so it reaches
    // the availability check rather than being caught as already past.
    expect(plan({ startsAt: at(20) })).toEqual({ ok: false, reason: "slot_not_open" });
  });

  it("refuses a day the host is closed", () => {
    const saturday = new Date(2026, 7, 8, 14, 0, 0);
    expect(plan({ startsAt: saturday })).toMatchObject({ reason: "beyond_booking_horizon" });
  });

  it("refuses a half-hour start even inside an open block", () => {
    const halfPast = new Date(2026, 7, 3, 14, 30, 0);
    expect(plan({ startsAt: halfPast })).toEqual({ ok: false, reason: "slot_not_open" });
  });

  it("refuses an hour whose session would overrun the block with its buffer", () => {
    // 16:00 plus a 60-minute session plus 30 minutes turnover passes 17:00.
    const result = plan({
      space: { ...SPACE, bufferMinutes: 30 },
      startsAt: at(16),
    });
    expect(result).toEqual({ ok: false, reason: "slot_not_open" });
  });

  it("refuses a time that has already passed", () => {
    expect(plan({ startsAt: at(9) })).toEqual({ ok: false, reason: "slot_in_past" });
  });

  it("refuses an hour someone else already took", () => {
    expect(plan({ takenStarts: [at(14)] })).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("allows the same hour on a space where it is not taken", () => {
    expect(plan({ takenStarts: [at(15)] }).ok).toBe(true);
  });
});

describe("the booking horizon is a paid benefit", () => {
  it("holds a standard practitioner to today", () => {
    expect(plan({ startsAt: at(14, 1) })).toEqual({
      ok: false,
      reason: "beyond_booking_horizon",
    });
  });

  it("lets Pro reach three days out", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, isPro: true },
      startsAt: at(14, 3),
    });
    expect(result.ok).toBe(true);
  });

  it("still stops Pro at four days", () => {
    expect(
      plan({ practitioner: { ...PRACTITIONER, isPro: true }, startsAt: at(14, 4) }),
    ).toEqual({ ok: false, reason: "beyond_booking_horizon" });
  });
});

describe("refusing to take money nobody can receive", () => {
  it("refuses when the host has no connected account", () => {
    expect(plan({ host: { stripeAccountId: null, chargesEnabled: false } })).toEqual({
      ok: false,
      reason: "host_cannot_be_paid",
    });
  });

  it("refuses when onboarding was started but never finished", () => {
    // Someone can abandon Stripe's hosted form halfway; the account exists
    // and cannot be paid.
    expect(plan({ host: { stripeAccountId: "acct_1", chargesEnabled: false } })).toEqual({
      ok: false,
      reason: "host_cannot_be_paid",
    });
  });

  it("refuses a listing still awaiting review", () => {
    expect(plan({ space: { ...SPACE, status: "pending" } })).toEqual({
      ok: false,
      reason: "space_not_active",
    });
  });

  it("refuses a delisted space", () => {
    expect(plan({ space: { ...SPACE, status: "delisted" } })).toEqual({
      ok: false,
      reason: "space_not_active",
    });
  });

  it("refuses a space that does not exist", () => {
    expect(plan({ space: null })).toEqual({ ok: false, reason: "space_not_found" });
  });
});

/**
 * The standing card promises these in words. Until this suite existed the
 * words were the whole implementation — a ladder that told people what they
 * had earned and then charged them for it anyway.
 */
describe("benefits that were earned rather than bought", () => {
  // Wednesday the 5th, two days out: past the same-day standard horizon and
  // inside the five days Established earns. A weekday, so the space is open.
  const twoDaysOut = at(14, 2);

  it("refuses a booking beyond today for somebody with no standing", () => {
    expect(plan({ startsAt: twoDaysOut, practitioner: PRACTITIONER })).toMatchObject({
      ok: false,
      reason: "beyond_booking_horizon",
    });
  });

  it("allows it once they reach Established", () => {
    expect(
      plan({ startsAt: twoDaysOut, practitioner: { ...PRACTITIONER, points: 100 } }).ok,
    ).toBe(true);
  });

  /** Paying must never leave somebody worse off than not paying. */
  it("gives a Pro with standing the longer of the two horizons", () => {
    const sevenDaysOut = at(14, 7);
    expect(
      plan({
        startsAt: sevenDaysOut,
        practitioner: { ...PRACTITIONER, isPro: true, points: 100 },
      }).ok,
    ).toBe(false);

    // Trusted reaches ten days, which is past both Pro's three and its own five.
    expect(
      plan({
        startsAt: sevenDaysOut,
        practitioner: { ...PRACTITIONER, isPro: true, points: 300 },
      }).ok,
    ).toBe(true);
  });

  it("charges the instant fee to somebody without standing", () => {
    const result = plan({ startsAt: at(11), practitioner: PRACTITIONER });
    expect(result.ok && result.money.instantFeeCents).toBeGreaterThan(0);
  });

  it("waives it at Trusted", () => {
    const result = plan({ startsAt: at(11), practitioner: { ...PRACTITIONER, points: 300 } });
    expect(result.ok && result.money.instantFeeCents).toBe(0);
  });

  /** The host is paid their rate either way — a waived fee comes out of ours. */
  it("still pays the host in full when the fee is waived", () => {
    const waived = plan({ startsAt: at(11), practitioner: { ...PRACTITIONER, points: 300 } });
    const charged = plan({ startsAt: at(11), practitioner: PRACTITIONER });

    expect(waived.ok && charged.ok).toBe(true);
    if (waived.ok && charged.ok) {
      expect(waived.money.hostRateCents).toBe(charged.money.hostRateCents);
      expect(waived.money.totalCents).toBeLessThan(charged.money.totalCents);
    }
  });
});
