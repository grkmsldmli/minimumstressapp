import { describe, expect, it } from "vitest";

import { DEFAULT_OCCUPANCY, OCCUPANCIES, earningsFor, earningsRange } from "./host-earnings";
import { SERVICE_FEE_RATE, quote } from "./money";

/**
 * A number a host will check against their own bank statement.
 *
 * This is the arithmetic behind a public page that says a spare room could
 * earn a specific amount, which makes it the one piece of maths here that
 * somebody will hold us to. So the tests are less about the multiplication and
 * more about the two claims underneath it: that the host keeps their rate, and
 * that nothing here quietly assumes the room books solid.
 */

describe("what a room earns", () => {
  it("is the rate times the hours that actually book", () => {
    // $50, 10 free hours a week, a quarter of them booked. 10 × 52/12 × 0.25
    // is 10.83 hours a month, at $50 → $541.67.
    const earnings = earningsFor({
      hourlyRateCents: 5000,
      freeHoursPerWeek: 10,
      occupancy: 0.25,
    });

    expect(earnings.bookedHoursPerMonth).toBeCloseTo(10.833, 2);
    expect(earnings.monthlyCents).toBe(54167);
  });

  /*
   * A month of four weeks is the easy mistake and it understates by 8% —
   * roughly one month's earnings a year, missing, on a page whose entire job
   * is to be worth trusting.
   */
  it("uses a real month, not four weeks", () => {
    const real = earningsFor({ hourlyRateCents: 5000, freeHoursPerWeek: 10, occupancy: 1 });
    const fourWeeks = 5000 * 10 * 4;

    expect(real.monthlyCents).toBeGreaterThan(fourWeeks);
    expect(real.monthlyCents / 12).toBeCloseTo((5000 * 10 * 52) / 12 / 12, 0);
  });

  it("takes the year from the year, not from twelve rounded months", () => {
    const earnings = earningsFor({
      hourlyRateCents: 3333,
      freeHoursPerWeek: 7,
      occupancy: 1 / 3,
    });

    // Rounding a month and multiplying it by twelve drifts by a few dollars,
    // which is exactly the kind of thing somebody adds up by hand and writes
    // in to ask about.
    expect(earnings.yearlyCents).toBe(Math.round(3333 * 7 * 52 * (1 / 3)));
  });
});

/**
 * The claim the page makes about whose money it is.
 *
 * The host keeps their rate. The service fee is added on top and the
 * practitioner pays it — which is unusual enough that a host will assume the
 * opposite, and it is the single most persuasive true thing on the page.
 */
describe("the host keeps their rate", () => {
  it("deducts nothing", () => {
    const earnings = earningsFor({
      hourlyRateCents: 4000,
      freeHoursPerWeek: 1,
      occupancy: 1,
    });
    // 52 weeks over 12 months, one hour a week, at $40.
    expect(earnings.monthlyCents).toBe(Math.round(4000 * (52 / 12)));
  });

  /*
   * And what the practitioner sees agrees with what the booking will actually
   * charge them. Two places computing the same fee is how a page ends up
   * quoting a total that checkout then contradicts.
   */
  it("shows the practitioner the same total the booking will", () => {
    for (const rate of [2500, 4000, 5500, 12000]) {
      const shown = earningsFor({
        hourlyRateCents: rate,
        freeHoursPerWeek: 1,
        occupancy: 1,
      }).practitionerPaysCents;

      expect(shown, `$${rate / 100}`).toBe(quote({ hostRateCents: rate, isInstant: false, isPro: false }).totalCents);
    }
  });

  it("adds the fee on top rather than taking it out", () => {
    const earnings = earningsFor({ hourlyRateCents: 5000, freeHoursPerWeek: 1, occupancy: 1 });
    expect(earnings.practitionerPaysCents).toBe(5000 + 5000 * SERVICE_FEE_RATE);
    expect(earnings.practitionerPaysCents).toBeGreaterThan(5000);
  });
});

describe("occupancy", () => {
  /*
   * The default is the low one on purpose. A calculator that opens on its best
   * case is an advert, and the first month teaches the host to discount
   * everything else the site told them.
   */
  it("defaults to the most conservative option offered", () => {
    expect(DEFAULT_OCCUPANCY).toBe(Math.min(...OCCUPANCIES.map((o) => o.value)));
  });

  it("never promises a room books solid", () => {
    expect(Math.max(...OCCUPANCIES.map((o) => o.value))).toBeLessThan(1);
  });

  it("gives a range whose ends are the options offered", () => {
    const { low, high } = earningsRange(5000, 10);
    expect(low.monthlyCents).toBeLessThan(high.monthlyCents);
    expect(low.monthlyCents).toBe(
      earningsFor({ hourlyRateCents: 5000, freeHoursPerWeek: 10, occupancy: 0.25 }).monthlyCents,
    );
    expect(high.monthlyCents).toBe(
      earningsFor({ hourlyRateCents: 5000, freeHoursPerWeek: 10, occupancy: 0.5 }).monthlyCents,
    );
  });
});

describe("numbers a form can produce", () => {
  /*
   * Every one of these arrives from a text input, so every one of them will
   * arrive at some point. An earnings figure of NaN on a page promising income
   * is worse than a zero.
   */
  it("answers zero rather than nonsense", () => {
    for (const input of [
      { hourlyRateCents: 0, freeHoursPerWeek: 10, occupancy: 0.25 },
      { hourlyRateCents: 5000, freeHoursPerWeek: 0, occupancy: 0.25 },
      { hourlyRateCents: -5000, freeHoursPerWeek: 10, occupancy: 0.25 },
      { hourlyRateCents: 5000, freeHoursPerWeek: -3, occupancy: 0.25 },
    ]) {
      const earnings = earningsFor(input);
      expect(Number.isFinite(earnings.monthlyCents), JSON.stringify(input)).toBe(true);
      expect(earnings.monthlyCents, JSON.stringify(input)).toBe(0);
    }
  });

  it("clamps an occupancy outside nought and one", () => {
    const solid = earningsFor({ hourlyRateCents: 5000, freeHoursPerWeek: 10, occupancy: 4 });
    expect(solid.monthlyCents).toBe(
      earningsFor({ hourlyRateCents: 5000, freeHoursPerWeek: 10, occupancy: 1 }).monthlyCents,
    );

    expect(
      earningsFor({ hourlyRateCents: 5000, freeHoursPerWeek: 10, occupancy: -1 }).monthlyCents,
    ).toBe(0);
  });

  it("does not fall over on a rate somebody typed in dollars by mistake", () => {
    const earnings = earningsFor({ hourlyRateCents: 45, freeHoursPerWeek: 10, occupancy: 0.25 });
    expect(earnings.monthlyCents).toBe(Math.round(45 * 10 * (52 / 12) * 0.25));
  });
});
