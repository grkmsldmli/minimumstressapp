/**
 * All marketplace money math. Pure functions, integer cents, no I/O.
 *
 * Two guarantees hold for every possible input, and the test suite exists to
 * prove it:
 *
 *   1. The host receives exactly the rate they set. Nothing is ever deducted
 *      from it — not the service fee, not a Pro discount, nothing.
 *   2. The platform's cut never falls below what Stripe charges to process the
 *      payment, so a heavily credited booking costs us $0 rather than real cash.
 */

import { addDays, civilIn, compareCivil } from "./timezone";

/** Service fee added on top of the host's rate. Never taken out of it. */
export const SERVICE_FEE_RATE = 0.2;

/** Flat fee on slots starting within the instant window. 100% platform revenue. */
export const INSTANT_FEE_CENTS = 500;

/**
 * Pro sells access, never a discount.
 *
 * It used to take 10% off the all-in total, absorbed entirely by us. The
 * arithmetic of that was fatal and went unnoticed for months: the discount
 * comes off what the practitioner pays, but it is funded from a margin that is
 * only about a sixth of it — so 10% of the total is 60% of ours. Measured on a
 * $35 room, a Pro booking left us $1.40 where a free one left $5.48, and the
 * subscription stopped covering the gap at the third booking of the month.
 *
 * Which meant Pro lost the most money on exactly the person it was sold to.
 * The busier the practitioner, the worse it got, with no ceiling.
 *
 * So nothing Pro gives may scale with usage. What it gives instead — the cap
 * lifted, thirty days of reach, a whole term booked at once, no card fee on an
 * early cancellation — costs nothing per booking and earns more as somebody
 * books more, because every session pays full freight.
 */

/** Pro subscription price, practitioner-side only. */
export const PRO_PRICE_CENTS = 990;

/** A slot starting within this window of now is "Instant". */
export const INSTANT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Cancel at least this far ahead and the authorization is voided, never charged. */
export const FREE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead anyone can book. One number, and it is the whole schedule.
 *
 * This was a tier: same-day only unless you paid, and three days if you did.
 * With real listings on the board it was plainly wrong. Availability repeats
 * weekly, so a host open on Tuesdays and Fridays was invisible to a free
 * account on five days out of seven — somebody opening the app on a Saturday
 * saw an empty screen and left, never learning there was a Pro tier to buy.
 * That is not a paywall, it is a product that does not work on most visits.
 *
 * Seven days is exactly the whole schedule, because a weekly cycle repeats
 * inside any seven-day window: every slot a host offers appears, whichever day
 * somebody happens to look. Nothing is withheld.
 *
 * Pro keeps what actually saves money: the instant fee waived, and 10% off
 * every booking. Both are worth something on every session. Access to the
 * product was never a thing worth selling.
 *
 * How far it reaches is set below, and it is now a product decision rather
 * than a payment one — see BOOKING_HORIZON_DAYS.
 */

/**
 * Longest a finished session can wait to be paid out. Two sweeps a day.
 *
 * No longer a constraint on how far ahead anybody can book — the money is
 * already ours by then — but still the delay a host feels between using their
 * room and seeing the transfer.
 */
export const CAPTURE_SWEEP_HOURS = 12;

/**
 * How far ahead a booking may be made.
 *
 * This was seven days, and it was seven because a card authorisation dies at
 * about seven — the app held the money rather than taking it, so the schedule
 * could not outlive the hold. It did not even manage that: a day of slots runs
 * to 23:00, so the furthest booking was 191 hours out against a 168-hour hold,
 * and the capture would simply have been refused. The host would have let
 * somebody into their studio and never been paid, quietly.
 *
 * The money is taken at booking now and held by us, not by the card network,
 * so that ceiling is gone. What is left is a real question about how far ahead
 * a room can honestly be promised, and fourteen days is the answer: two full
 * turns of a weekly schedule, far enough to plan a fortnight of classes, and
 * near enough that a host changing their hours does not invalidate bookings
 * they made a season ago.
 */
export const BOOKING_HORIZON_DAYS = 14;

/**
 * How far a Pro account reaches. Thirty days, and it costs us nothing.
 *
 * Tiering the horizon was wrong once and is not wrong here, and the difference
 * is worth stating. The old version gave free accounts a single day, which hid
 * most of a host's week from them — a room open on Tuesdays was invisible to
 * anybody looking on a Wednesday, and the app appeared empty to somebody who
 * had never booked. Nothing is hidden now: fourteen days shows every slot in a
 * weekly cycle twice over. Thirty is room to plan a term, not access to a
 * schedule somebody else cannot see.
 */
export const PRO_BOOKING_HORIZON_DAYS = 30;

/** How far this account reaches, in days. */
export function horizonDaysFor(isPro: boolean): number {
  return isPro ? PRO_BOOKING_HORIZON_DAYS : BOOKING_HORIZON_DAYS;
}

/**
 * How many sessions a free account may have on the calendar at once.
 *
 * This is what Pro sells instead of the schedule. Hiding hours broke the app
 * for somebody who had never booked at all; a limit on how many bookings run
 * concurrently is invisible until somebody is already getting real use out of
 * it, and is felt only by the practitioner running several rooms a week — who
 * is exactly the person for whom the fee waiver and the 10% already pay for
 * the subscription several times over.
 *
 * Counted as sessions still ahead, not sessions ever booked. Somebody who has
 * run two hundred and has none coming up is at zero: this caps how much is
 * held at once, not how much anybody may use the marketplace.
 */
export const MAX_UPCOMING_BOOKINGS_FREE = 3;

/** @deprecated Read horizonDaysFor instead — the two tiers differ again. */
export const STANDARD_HORIZON_DAYS = BOOKING_HORIZON_DAYS;
export const PRO_HORIZON_DAYS = PRO_BOOKING_HORIZON_DAYS;

/** Stripe standard US card pricing, used to size the platform's floor. */
export const STRIPE_PERCENT = 0.029;
export const STRIPE_FIXED_CENTS = 30;

export type AccessType = "keypad" | "lockbox" | "greeter";

/**
 * Below a certain rate no booking can pay for itself: the service fee is a
 * percentage, but Stripe's 30c is flat, so at small enough rates the fee cannot
 * cover processing however the credit floor behaves.
 *
 * The threshold is higher for Pro, because Pro's discount is intentionally not
 * floored — see `quote`. Searched rather than hardcoded so it stays correct if
 * the constants above are retuned.
 *
 * The brief sets no minimum hourly rate. This is the arithmetic floor, not a
 * business one; a real marketplace minimum belongs well above it.
 */
const cachedMinViableRate = new Map<boolean, number>();

/**
 * Viability is not monotonic near the boundary. The service fee and the Pro
 * discount each round independently, so a rate one cent higher can tip the
 * discount up without moving the fee — at a $6.03 rate Pro nets zero, while
 * $6.04 loses a cent. Taking the *first* viable rate would therefore report a
 * floor with unviable rates above it. This scans for the last unviable rate
 * instead, so everything at or above the answer is genuinely safe.
 */
function computeMinViableHostRate(isPro: boolean): number {
  const STABLE_RUN = 1000; // cents of consecutive viability before we trust the tail
  const SCAN_LIMIT = 100_000;

  let lastUnviable = 0;
  let run = 0;

  // Instant slots only add platform revenue, so a normal slot is the worst case.
  for (let rate = 1; rate <= SCAN_LIMIT; rate += 1) {
    const q = quote({ hostRateCents: rate, isInstant: false, isPro });
    if (q.platformNetCents < 0) {
      lastUnviable = rate;
      run = 0;
    } else if (++run >= STABLE_RUN) {
      return lastUnviable + 1;
    }
  }
  throw new Error("host rate viability never stabilised — check the fee constants");
}

export function minViableHostRateCents(isPro = false): number {
  const cached = cachedMinViableRate.get(isPro);
  if (cached !== undefined) return cached;

  const rate = computeMinViableHostRate(isPro);
  cachedMinViableRate.set(isPro, rate);
  return rate;
}

/** True when a booking at this rate can at least pay for its own processing. */
export function isViableHostRate(hostRateCents: number, isPro = false): boolean {
  return hostRateCents >= minViableHostRateCents(isPro);
}

export interface QuoteInput {
  /** What the host set and what the host receives. The only canonical price. */
  hostRateCents: number;
  isInstant: boolean;
  isPro: boolean;
}

export interface Quote {
  /** Always equals hostRateCents. Asserted in tests under every combination. */
  hostCents: number;
  serviceFeeCents: number;
  instantFeeCents: number;
  proDiscountCents: number;
  /** What the practitioner's card is authorized for. */
  totalCents: number;
  /** Platform's gross cut: what Stripe takes as the application fee. */
  platformCents: number;
  /** Estimated Stripe processing cost, paid out of the platform's cut. */
  stripeFeeCents: number;
  /** Platform's cut after processing. */
  platformNetCents: number;
}

function assertMoney(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer of cents, got ${value}`);
  }
}

/**
 * What Stripe charges to process a payment of this size. Rounded up so we never
 * under-reserve by a cent.
 *
 * Checked against a real sandbox charge: on $59.00 Stripe took 201c, while this
 * returns 202c. Stripe rounds the percentage where this ceilings it, so the
 * estimate runs a cent high — the safe direction, since the credit floor is
 * built on it and over-reserving costs a practitioner a cent of rollover rather
 * than costing us the payment.
 */
export function estimateStripeFeeCents(totalCents: number): number {
  assertMoney(totalCents, "totalCents");
  if (totalCents === 0) return 0;
  return Math.ceil(totalCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
}

/**
 * The smallest platform cut that still covers Stripe on the resulting total.
 *
 * Total is `hostRate + platform`, and Stripe's fee scales with total, so the
 * constraint `platform >= stripeFee(hostRate + platform)` is circular. Solving
 * `p >= (hostRate + p) * pct + fixed` for p gives the closed form below, which
 * avoids iterating to a fixed point.
 */
export function minPlatformCents(hostRateCents: number): number {
  assertMoney(hostRateCents, "hostRateCents");
  return Math.ceil(
    (STRIPE_PERCENT * hostRateCents + STRIPE_FIXED_CENTS) / (1 - STRIPE_PERCENT),
  );
}

/**
 * Price a booking.
 *
 * Order matters: Pro waives the instant fee before the percentage discount is
 * taken, so a Pro user never pays a discounted version of a fee they were
 * promised they'd skip.
 *
 * The Pro discount is deliberately *not* floored the way credit is. Pro is a
 * paid entitlement — advertising 10% off and silently delivering less would be
 * a worse failure than the few cents we lose on an unusually cheap booking, and
 * the subscription revenue covers it. Credit is goodwill, so partial redemption
 * with the remainder rolled over is honest and keeps us cash-positive.
 */
export function quote(input: QuoteInput): Quote {
  /*
   * `isPro` is deliberately read no further. It stays on the input so callers
   * keep passing it and the test suite can assert, across every rate and both
   * instant states, that a Pro account is quoted exactly what anybody else is.
   * Dropping the field would remove the thing that proves the indifference.
   */
  const { hostRateCents, isInstant } = input;
  assertMoney(hostRateCents, "hostRateCents");

  const serviceFeeCents = Math.round(hostRateCents * SERVICE_FEE_RATE);

  /*
   * The instant fee is charged to everyone, Pro included.
   *
   * Waiving it was the same unbounded shape as the discount — $5 of pure
   * margin given away per instant booking, against a fixed subscription. Pro
   * buys room on the calendar, not cheaper hours.
   */
  const instantFeeCents = isInstant ? INSTANT_FEE_CENTS : 0;

  // Kept at zero rather than removed: a booking freezes its own breakdown, and
  // rows written while the discount existed still carry what they were sold at.
  const proDiscountCents = 0;

  const platformCents = serviceFeeCents + instantFeeCents;
  const totalCents = hostRateCents + platformCents;
  const stripeFeeCents = estimateStripeFeeCents(totalCents);

  return {
    hostCents: hostRateCents,
    serviceFeeCents,
    instantFeeCents,
    proDiscountCents,
    totalCents,
    platformCents,
    stripeFeeCents,
    platformNetCents: platformCents - stripeFeeCents,
  };
}

/** The money frozen onto a booking row at creation, so later rate changes never rewrite history. */
export interface BookingMoney {
  hostRateCents: number;
  serviceFeeCents: number;
  instantFeeCents: number;
  proDiscountCents: number;
  totalCents: number;
  platformCents: number;
}

export function bookingMoneyFromQuote(q: Quote): BookingMoney {
  return {
    hostRateCents: q.hostCents,
    serviceFeeCents: q.serviceFeeCents,
    instantFeeCents: q.instantFeeCents,
    proDiscountCents: q.proDiscountCents,
    totalCents: q.totalCents,
    platformCents: q.platformCents,
  };
}

/**
 * The all-in hourly price shown on public pages: the host's rate plus the
 * service fee every booking pays.
 *
 * Presentation only. It reads the same quote() the checkout uses (non-instant),
 * so the figure a guest sees before booking is the figure they are charged —
 * ahead of only the last-minute instant surcharge, which applies to same-hour
 * slots and is shown at checkout. It changes no pricing, percentage or Stripe
 * amount; it composes the ones that already exist so the site and the app quote
 * the same number.
 */
export function publicHourlyTotalCents(hostRateCents: number): number {
  return quote({ hostRateCents, isInstant: false, isPro: false }).totalCents;
}

export type CancellationActor = "practitioner" | "host";

export interface CancellationOutcome {
  /**
   * `void` means the practitioner owes nothing, `capture_full` that they owe
   * the lot. The names predate the money being taken up front, and they still
   * describe the decision rather than the Stripe call — settlementFor turns
   * them into a refund, or into leaving what was paid alone.
   */
  action: "void" | "capture_full";
  chargedCents: number;
  reason: string;
}

/**
 * Resolve a cancellation.
 *
 * A host cancelling releases the hold in full and the practitioner is charged
 * nothing. There was a goodwill credit on top of that, and it is gone — not
 * because the compensation was wrong but because a balance somebody has to
 * track, explain and reconcile is a second system, and the point right now is
 * one that works. Losing a room to a host's cancellation still costs the
 * practitioner nothing, which is the part that matters.
 */
export function resolveCancellation(
  booking: BookingMoney,
  actor: CancellationActor,
  sessionStart: Date,
  now: Date,
  /** Pro pays no card fee on an early cancellation. One of the things it buys. */
  isPro = false,
): CancellationOutcome {
  /*
   * A host cancelling costs the practitioner nothing at all, processing
   * included. They arranged their day around a room somebody else took away;
   * charging them a fee for that would be indefensible, so this is the one
   * cancellation whose cost we absorb.
   */
  if (actor === "host") {
    return {
      action: "void",
      chargedCents: 0,
      reason: "Host cancelled — refunded in full, nothing charged",
    };
  }

  if (isFreeCancellation(sessionStart, now)) {
    /*
     * Pro absorbs the processing cost, and this is the only Pro benefit that
     * costs us anything at all. It is bounded — a couple of dollars a month
     * against $9.90 — which is the test every other benefit had to pass too.
     */
    if (isPro) {
      return {
        action: "void",
        chargedCents: 0,
        reason: "Cancelled 24 or more hours ahead — refunded in full, card fee included with Pro",
      };
    }

    return {
      action: "void",
      chargedCents: cancellationCostCents(booking.totalCents),
      reason: "Cancelled 24 or more hours ahead — refunded apart from the card fee",
    };
  }

  return {
    action: "capture_full",
    chargedCents: booking.totalCents,
    reason: "Cancelled inside 24 hours — charged in full, not refunded",
  };
}

/**
 * What a cancellation costs the person cancelling.
 *
 * Stripe keeps its processing fee when a charge is refunded — measured, not
 * assumed: a $42.00 booking refunded in full returns $42.00 to the card and
 * leaves us $1.52 down, with no revenue against it. Free cancellation is a
 * promise we make on purpose, but paying for somebody else's change of plan
 * out of our own margin is not part of it.
 *
 * So the processing cost stays with whoever caused it, and nothing else does.
 * This is deliberately milder than the industry it sits in — Airbnb keeps the
 * whole guest service fee, ticketing keeps every fee always — and it is priced
 * at cost rather than as a penalty. We are not made better off by a
 * cancellation; we are simply not made worse.
 *
 * It has to be said before somebody books, not discovered afterwards. See the
 * calendar footer, the payment sheet and the terms.
 */
export function cancellationCostCents(totalCents: number): number {
  return estimateStripeFeeCents(totalCents);
}

/** What actually returns to the card when a practitioner cancels early. */
export function earlyCancellationRefundCents(totalCents: number): number {
  return Math.max(0, totalCents - cancellationCostCents(totalCents));
}

/** True when a slot falls inside the instant window, measured against real wall-clock time. */
export function isInstantSlot(slotStart: Date, now: Date): boolean {
  const diff = slotStart.getTime() - now.getTime();
  return diff >= 0 && diff <= INSTANT_WINDOW_MS;
}

/** True when cancelling now voids the authorization instead of capturing it. */
export function isFreeCancellation(sessionStart: Date, now: Date): boolean {
  return sessionStart.getTime() - now.getTime() >= FREE_CANCEL_WINDOW_MS;
}

/**
 * How far ahead this practitioner may book. Compared by calendar day, so "same
 * day" means the rest of today rather than the next 24 hours.
 *
 * `extraDays` is standing, passed in rather than looked up: this module knows
 * about money and nothing about tiers, and the caller takes whichever of the
 * two horizons is longer so paying never leaves somebody worse off than not
 * paying.
 *
 * Counted in the room's timezone, which is the only one both sides of the
 * request can agree on. Counting in the reader's zone would put the client and
 * the server a day apart for anyone east or west of the studio, and the seventh
 * day would be offered on the phone and refused on the way in.
 */
export function isWithinBookingHorizon(
  slotStart: Date,
  now: Date,
  isPro: boolean,
  timeZone: string,
  extraDays = 0,
): boolean {
  if (slotStart.getTime() < now.getTime()) return false;

  const horizonDays = Math.max(horizonDaysFor(isPro), extraDays);
  const lastBookableDay = addDays(civilIn(now, timeZone), horizonDays);

  return compareCivil(civilIn(slotStart, timeZone), lastBookableDay) <= 0;
}

/** Ledger entries are append-only deltas; the balance is always their sum. */
export interface CreditLedgerEntry {
  deltaCents: number;
  reason: string;
}

export function creditBalance(entries: readonly CreditLedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.deltaCents, 0);
}

/** Format cents for display: 5400 -> "$54.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
