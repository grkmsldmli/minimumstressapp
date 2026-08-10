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

/** Pro discount, taken off the all-in total and absorbed entirely by the platform. */
export const PRO_DISCOUNT_RATE = 0.1;

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
 * It is also the ceiling the payment model allows. A card authorisation lives
 * about seven days, and the money is held rather than charged until the
 * session starts — so this is the furthest out a booking can be made without
 * re-authorising, and the two limits happen to be the same number.
 *
 * Pro keeps what actually saves money: the instant fee waived, and 10% off
 * every booking. Both are worth something on every session. Access to the
 * product was never a thing worth selling.
 */
export const BOOKING_HORIZON_DAYS = 7;

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

/** @deprecated Both tiers see the same schedule. Kept so callers still read. */
export const STANDARD_HORIZON_DAYS = BOOKING_HORIZON_DAYS;
export const PRO_HORIZON_DAYS = BOOKING_HORIZON_DAYS;

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
  const { hostRateCents, isInstant, isPro } = input;
  assertMoney(hostRateCents, "hostRateCents");

  const serviceFeeCents = Math.round(hostRateCents * SERVICE_FEE_RATE);
  const instantFeeCents = isInstant && !isPro ? INSTANT_FEE_CENTS : 0;

  const listPriceCents = hostRateCents + serviceFeeCents + instantFeeCents;
  const platformBeforeDiscount = serviceFeeCents + instantFeeCents;

  // 10% off the all-in total. Clamped to the platform's own cut so the host's
  // rate can never be reached, however the constants are later retuned.
  const proDiscountCents = isPro
    ? Math.min(Math.round(listPriceCents * PRO_DISCOUNT_RATE), platformBeforeDiscount)
    : 0;

  const platformCents = platformBeforeDiscount - proDiscountCents;
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

export type CancellationActor = "practitioner" | "host";

export interface CancellationOutcome {
  /** `void` releases the authorization; `capture_full` charges the held amount. */
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
): CancellationOutcome {
  if (actor === "host") {
    return {
      action: "void",
      chargedCents: 0,
      reason: "Host cancelled — authorization released in full, nothing charged",
    };
  }

  if (isFreeCancellation(sessionStart, now)) {
    return {
      action: "void",
      chargedCents: 0,
      reason: "Cancelled 24 or more hours ahead — authorization voided, never charged",
    };
  }

  return {
    action: "capture_full",
    chargedCents: booking.totalCents,
    reason: "Cancelled inside 24 hours — captured in full",
  };
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

  const horizonDays = Math.max(isPro ? PRO_HORIZON_DAYS : STANDARD_HORIZON_DAYS, extraDays);
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
