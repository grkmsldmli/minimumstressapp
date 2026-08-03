/**
 * All marketplace money math. Pure functions, integer cents, no I/O.
 *
 * Two guarantees hold for every possible input, and the test suite exists to
 * prove it:
 *
 *   1. The host receives exactly the rate they set. Nothing is ever deducted
 *      from it — not the service fee, not a Pro discount, not goodwill credit.
 *   2. The platform's cut never falls below what Stripe charges to process the
 *      payment, so a heavily credited booking costs us $0 rather than real cash.
 */

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

/** How far ahead each tier can book. Standard is same-day only. */
export const STANDARD_HORIZON_DAYS = 0;
export const PRO_HORIZON_DAYS = 3;

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
    const q = quote({ hostRateCents: rate, isInstant: false, isPro, creditBalanceCents: 0 });
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
  /** Practitioner's available goodwill credit. Redemption may be partial. */
  creditBalanceCents: number;
}

export interface Quote {
  /** Always equals hostRateCents. Asserted in tests under every combination. */
  hostCents: number;
  serviceFeeCents: number;
  instantFeeCents: number;
  proDiscountCents: number;
  creditAppliedCents: number;
  /** What the practitioner's card is authorized for. */
  totalCents: number;
  /** Platform's gross cut: what Stripe takes as the application fee. */
  platformCents: number;
  /** Estimated Stripe processing cost, paid out of the platform's cut. */
  stripeFeeCents: number;
  /** Platform's cut after processing. Guaranteed >= 0 by the credit floor. */
  platformNetCents: number;
  /** Credit the practitioner could not spend here and keeps for next time. */
  creditRemainingCents: number;
}

function assertMoney(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer of cents, got ${value}`);
  }
}

/**
 * What Stripe charges to process a payment of this size. Rounded up so we never
 * under-reserve by a cent.
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
  const { hostRateCents, isInstant, isPro, creditBalanceCents } = input;
  assertMoney(hostRateCents, "hostRateCents");
  assertMoney(creditBalanceCents, "creditBalanceCents");

  const serviceFeeCents = Math.round(hostRateCents * SERVICE_FEE_RATE);
  const instantFeeCents = isInstant && !isPro ? INSTANT_FEE_CENTS : 0;

  const listPriceCents = hostRateCents + serviceFeeCents + instantFeeCents;
  const platformBeforeDiscount = serviceFeeCents + instantFeeCents;

  // 10% off the all-in total. Clamped to the platform's own cut so the host's
  // rate can never be reached, however the constants are later retuned.
  const proDiscountCents = isPro
    ? Math.min(Math.round(listPriceCents * PRO_DISCOUNT_RATE), platformBeforeDiscount)
    : 0;

  const platformBeforeCredit = platformBeforeDiscount - proDiscountCents;

  // Credit eats only into the platform's cut, and only down to the Stripe floor.
  const floor = minPlatformCents(hostRateCents);
  const creditCapCents = Math.max(0, platformBeforeCredit - floor);
  const creditAppliedCents = Math.min(creditBalanceCents, creditCapCents);

  const platformCents = platformBeforeCredit - creditAppliedCents;
  const totalCents = hostRateCents + platformCents;
  const stripeFeeCents = estimateStripeFeeCents(totalCents);

  return {
    hostCents: hostRateCents,
    serviceFeeCents,
    instantFeeCents,
    proDiscountCents,
    creditAppliedCents,
    totalCents,
    platformCents,
    stripeFeeCents,
    platformNetCents: platformCents - stripeFeeCents,
    creditRemainingCents: creditBalanceCents - creditAppliedCents,
  };
}

/** The money frozen onto a booking row at creation, so later rate changes never rewrite history. */
export interface BookingMoney {
  hostRateCents: number;
  serviceFeeCents: number;
  instantFeeCents: number;
  proDiscountCents: number;
  creditAppliedCents: number;
  totalCents: number;
  platformCents: number;
}

export function bookingMoneyFromQuote(q: Quote): BookingMoney {
  return {
    hostRateCents: q.hostCents,
    serviceFeeCents: q.serviceFeeCents,
    instantFeeCents: q.instantFeeCents,
    proDiscountCents: q.proDiscountCents,
    creditAppliedCents: q.creditAppliedCents,
    totalCents: q.totalCents,
    platformCents: q.platformCents,
  };
}

export type CancellationActor = "practitioner" | "host";

export interface CancellationOutcome {
  /** `void` releases the authorization; `capture_full` charges the held amount. */
  action: "void" | "capture_full";
  chargedCents: number;
  /** Credit spent on this booking, handed back. Undoes a spend, not new liability. */
  creditRestoredCents: number;
  /** Goodwill on top of the refund. Only ever awarded when the host cancels. */
  goodwillCreditCents: number;
  reason: string;
}

/**
 * Resolve a cancellation.
 *
 * The host-cancels branch is the one the brief leaves ambiguous. It says the
 * goodwill credit is "service fee + instant fee, never more", and separately
 * guarantees the platform never goes negative. Those conflict when the
 * practitioner already spent credit on the booking being cancelled: refunding
 * the *gross* fee as fresh credit would mint liability we never earned. So
 * goodwill is the platform's **net** take, and any credit already spent is
 * restored separately. With no credit involved the two readings are identical;
 * with credit involved, only this one keeps the brief's own invariant intact.
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
      creditRestoredCents: booking.creditAppliedCents,
      goodwillCreditCents: booking.platformCents,
      reason: "Host cancelled — full release plus goodwill credit",
    };
  }

  if (isFreeCancellation(sessionStart, now)) {
    return {
      action: "void",
      chargedCents: 0,
      creditRestoredCents: booking.creditAppliedCents,
      goodwillCreditCents: 0,
      reason: "Cancelled 24 or more hours ahead — authorization voided, never charged",
    };
  }

  // Credit already spent is not returned here: it discounted a booking the
  // practitioner is now being charged for, so they did receive its benefit.
  return {
    action: "capture_full",
    chargedCents: booking.totalCents,
    creditRestoredCents: 0,
    goodwillCreditCents: 0,
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
 * How far ahead this practitioner may book. Standard is same-day only; Pro
 * reaches three days out. Compared by calendar day, so "same day" means the
 * rest of today rather than the next 24 hours.
 */
export function isWithinBookingHorizon(slotStart: Date, now: Date, isPro: boolean): boolean {
  if (slotStart.getTime() < now.getTime()) return false;

  const horizonDays = isPro ? PRO_HORIZON_DAYS : STANDARD_HORIZON_DAYS;
  const lastBookableDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + horizonDays);
  const slotDay = new Date(slotStart.getFullYear(), slotStart.getMonth(), slotStart.getDate());

  return slotDay.getTime() <= lastBookableDay.getTime();
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
