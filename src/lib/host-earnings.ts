import { SERVICE_FEE_RATE } from "./money";

/**
 * What an unused room could earn, from the host's own numbers.
 *
 * The point of this arithmetic is that a host with a spare treatment room has
 * usually never put a figure on the hours it stands empty. "It's empty on
 * Tuesdays" is not a number; "$620 a month" is, and it is the difference
 * between an idea and a decision.
 *
 * Two things keep it honest, and both are the parts most calculators of this
 * kind leave out.
 *
 * The first is occupancy. Multiplying every free hour by the rate promises
 * full booking, which nothing achieves — a page that quotes it is quoting a
 * number the host will never see, and the first month teaches them the site
 * lied. So occupancy is an input with a conservative default, not a hidden
 * assumption, and the answer is a range rather than a figure.
 *
 * The second is whose money it is. The host keeps their rate: the service fee
 * is added on top and the practitioner pays it, so nothing is deducted here.
 * That is worth stating plainly rather than implying, because every host
 * reading this has been trained by other platforms to expect a cut.
 */

/** 52 weeks over 12 months. A "month" of four weeks understates by 8%. */
const WEEKS_PER_MONTH = 52 / 12;

export interface EarningsInput {
  /** What the host would charge, in cents. Theirs to keep. */
  hourlyRateCents: number;
  /** Hours in a normal week the room is free and they would let it be used. */
  freeHoursPerWeek: number;
  /** The share of those hours that actually get booked, 0–1. */
  occupancy: number;
}

export interface Earnings {
  /** Hours actually booked in an average month, at that occupancy. */
  bookedHoursPerMonth: number;
  monthlyCents: number;
  yearlyCents: number;
  /**
   * What the practitioner pays for one of those hours.
   *
   * Shown because a host setting a rate is really asking "will anybody pay
   * this", and the number they are being compared against on the listing is
   * this one, not theirs.
   */
  practitionerPaysCents: number;
}

/** The occupancies offered, lowest first. Nothing here is a prediction. */
export const OCCUPANCIES = [
  { value: 0.25, label: "1 in 4 hours" },
  { value: 1 / 3, label: "1 in 3 hours" },
  { value: 0.5, label: "half the hours" },
] as const;

/**
 * The conservative one, on purpose.
 *
 * A calculator that opens on its best case is an advert. This opens on the
 * figure a host is most likely to beat, which is the only version of it they
 * will still trust in month two.
 */
export const DEFAULT_OCCUPANCY = OCCUPANCIES[0].value;

export function earningsFor(input: EarningsInput): Earnings {
  const rate = Math.max(0, Math.round(input.hourlyRateCents));
  const hours = Math.max(0, input.freeHoursPerWeek);
  const occupancy = Math.min(1, Math.max(0, input.occupancy));

  const bookedHoursPerMonth = hours * WEEKS_PER_MONTH * occupancy;
  const monthlyCents = Math.round(rate * bookedHoursPerMonth);

  return {
    bookedHoursPerMonth,
    monthlyCents,
    // Not monthly × 12 — that compounds the rounding twelve times and lands a
    // few dollars off what somebody gets adding the months up themselves.
    yearlyCents: Math.round(rate * hours * 52 * occupancy),
    practitionerPaysCents: rate + Math.round(rate * SERVICE_FEE_RATE),
  };
}

/**
 * The range across the occupancies offered, which is what the page shows.
 *
 * A single figure invites a host to treat it as a forecast. Two ends and the
 * assumption behind each is the same information without the promise.
 */
export function earningsRange(
  hourlyRateCents: number,
  freeHoursPerWeek: number,
): { low: Earnings; high: Earnings } {
  const values = OCCUPANCIES.map((o) => o.value);
  return {
    low: earningsFor({
      hourlyRateCents,
      freeHoursPerWeek,
      occupancy: Math.min(...values),
    }),
    high: earningsFor({
      hourlyRateCents,
      freeHoursPerWeek,
      occupancy: Math.max(...values),
    }),
  };
}
