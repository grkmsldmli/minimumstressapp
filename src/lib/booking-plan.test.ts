import { describe, expect, it } from "vitest";

import {
  explainRejection,
  planBooking,
  type HostFacts,
  type PractitionerFacts,
  type SpaceFacts,
} from "./booking-plan";
import { BOOKING_HORIZON_DAYS, INSTANT_FEE_CENTS, MAX_UPCOMING_BOOKINGS_FREE } from "./money";
import { addDays, instantFrom } from "./timezone";

/**
 * A Monday at 10:00 in the room's own city, with the room open 09:00-17:00
 * every weekday.
 *
 * The zone is named rather than inherited from the test runner. `planBooking`
 * runs on a server in UTC while the times it judges were chosen on a phone
 * somewhere else, so a fixture built from the ambient zone would only ever
 * prove that the runner agrees with itself.
 */
const ZONE = "America/Los_Angeles";
const MONDAY = { year: 2026, month: 8, day: 3 };

const at = (hour: number, dayOffset = 0): Date => {
  const instant = instantFrom(addDays(MONDAY, dayOffset), hour * 60, ZONE);
  if (!instant) throw new Error(`${hour}:00 does not exist on that day`);
  return instant;
};

const NOW = at(10);

const SPACE: SpaceFacts = {
  id: "sp_1",
  hostId: "host_1",
  hourlyRateCents: 4500,
  bufferMinutes: 0,
  status: "active",
  timeZone: ZONE,
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


  it("pays the host their full rate however the rest of it moves", () => {
    for (const isPro of [false, true]) {
      for (const hour of [11, 14]) {
        const result = plan({
          practitioner: { ...PRACTITIONER, isPro },
          startsAt: at(hour),
        });
        expect(result.ok && result.money.hostRateCents).toBe(4500);
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
    // Saturday. Inside the horizon now that everyone sees the week, so the
    // only thing left refusing it is the schedule — which is what this is for.
    const saturday = new Date(2026, 7, 8, 14, 0, 0);
    expect(plan({ startsAt: saturday })).toMatchObject({ reason: "slot_not_open" });
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

/**
 * The horizon stopped being a tier.
 *
 * It was same-day unless you paid, which made a host open on Tuesdays and
 * Fridays invisible to a free account five days out of seven.
 *
 * How far it reaches is set by the card hold, not chosen — see
 * BOOKING_HORIZON_DAYS. Written against the constant here for the same reason
 * it is derived there: the previous version of these tests named seven days,
 * which was the figure the money could not actually collect.
 */
describe("the booking horizon", () => {
  /*
   * The room here opens weekdays only, so the furthest day inside the window is
   * not necessarily a day it is open. Walking to the nearest open one keeps
   * these tests measuring the horizon rather than the calendar — otherwise a
   * horizon landing on a Saturday would "fail" for the wrong reason.
   */
  const isOpen = (dayOffset: number) => {
    const weekday = (1 + dayOffset) % 7; // BASE is a Monday.
    return weekday >= 1 && weekday <= 5;
  };

  const lastOpenInside = (() => {
    for (let day = BOOKING_HORIZON_DAYS; day > 0; day -= 1) if (isOpen(day)) return day;
    throw new Error("no open day inside the horizon");
  })();

  const firstOpenOutside = (() => {
    for (let day = BOOKING_HORIZON_DAYS + 1; day < BOOKING_HORIZON_DAYS + 8; day += 1) {
      if (isOpen(day)) return day;
    }
    throw new Error("no open day beyond the horizon");
  })();

  it("lets anybody reach the far end of it", () => {
    expect(plan({ startsAt: at(14, lastOpenInside) }).ok).toBe(true);
  });

  it("no longer holds a free account to today", () => {
    expect(plan({ startsAt: at(14, 1) }).ok).toBe(true);
  });

  it("gives Pro no further reach, because there is nothing further to give", () => {
    const free = plan({ startsAt: at(14, lastOpenInside) });
    const pro = plan({
      practitioner: { ...PRACTITIONER, isPro: true },
      startsAt: at(14, lastOpenInside),
    });
    expect(free.ok).toBe(true);
    expect(pro.ok).toBe(free.ok);
  });

  /**
   * How far a room can honestly be promised, and nothing to do with payment any
   * more — the money is taken at booking, so nothing expires while a booking
   * waits. See BOOKING_HORIZON_DAYS.
   */
  it("stops past the end of it, for everyone", () => {
    // Open, so the only thing refusing it is the horizon.
    for (const practitioner of [PRACTITIONER, { ...PRACTITIONER, isPro: true }]) {
      expect(plan({ practitioner, startsAt: at(14, firstOpenOutside) })).toEqual({
        ok: false,
        reason: "beyond_booking_horizon",
      });
    }
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
 * What Pro sells now that it no longer sells the schedule.
 *
 * Hiding hours broke the app for somebody who had never booked at all. A cap
 * on how many run at once is invisible until somebody is already getting real
 * use out of the marketplace — and that person is the one for whom the fee
 * waiver and the 10% already pay for the subscription several times over.
 */
describe("how many sessions can be held at once", () => {
  it("lets a free account book while under the limit", () => {
    expect(plan({ upcomingCount: MAX_UPCOMING_BOOKINGS_FREE - 1 }).ok).toBe(true);
  });

  it("refuses a free account at the limit", () => {
    expect(plan({ upcomingCount: MAX_UPCOMING_BOOKINGS_FREE })).toEqual({
      ok: false,
      reason: "too_many_upcoming",
    });
  });

  it("never refuses Pro for this", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, isPro: true },
      upcomingCount: MAX_UPCOMING_BOOKINGS_FREE * 10,
    });
    expect(result.ok).toBe(true);
  });

  /**
   * Checked before the slot, so the answer does not depend on which room was
   * tapped. Somebody at their limit is at their limit everywhere.
   */
  it("says so before complaining about the hour", () => {
    const closed = new Date(2026, 7, 8, 14, 0, 0);
    expect(plan({ upcomingCount: MAX_UPCOMING_BOOKINGS_FREE, startsAt: closed })).toEqual({
      ok: false,
      reason: "too_many_upcoming",
    });
  });

  it("tells somebody what to do about it", () => {
    const { message } = explainRejection("too_many_upcoming");
    expect(message).toContain(String(MAX_UPCOMING_BOOKINGS_FREE));
    expect(message).toMatch(/pro/i);
  });

  /** A cap on what is held at once, not on how much anybody may use this. */
  it("counts sessions ahead rather than sessions ever booked", () => {
    expect(plan({ upcomingCount: 0 }).ok).toBe(true);
  });
});
