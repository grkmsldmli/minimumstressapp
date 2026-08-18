/**
 * How a booking becomes money.
 *
 * Separate charges and transfers. The practitioner pays us when they book, the
 * money sits in our balance, and the host's rate is transferred to their
 * connected account once the session has happened.
 *
 * It used to be a destination charge with a manual capture: the card was held
 * rather than taken, and Stripe split the payment the moment we captured. That
 * arrangement could not survive taking the money up front. Stripe releases an
 * uncaptured hold after about seven days, which capped how far ahead anyone
 * could book — and paying the host at the moment of charge would mean every
 * refund clawing money back out of their account, days or weeks after they had
 * seen it arrive and quite possibly spent it.
 *
 * Holding the money ourselves until the session fixes both. There is no hold to
 * expire, so the calendar can reach as far as the product wants; and a refund
 * before the session touches nothing that was ever the host's.
 *
 * Pure functions here, no network. The Stripe calls live in `client.ts`; this
 * file is the part worth testing, because getting the split wrong silently
 * underpays a host on every booking.
 */

import type { BookingMoney } from "../money";

/**
 * Ties the charge and the later transfer together in Stripe's own records.
 *
 * Without it the two are unrelated objects and reconciling a host's payout back
 * to the practitioner who paid for it means trusting our database. With it,
 * Stripe can answer the question on its own.
 */
export function transferGroupFor(bookingId: string): string {
  return `booking_${bookingId}`;
}

/** What Stripe is told to do at booking time. */
export interface PaymentIntentPlan {
  /** Total charged to the practitioner's card, in cents. */
  amount: number;
  currency: "usd";
  /**
   * Taken, or only held.
   *
   * An ordinary booking is taken. Free cancellation is then a refund rather
   * than a released hold — slower, and it shows on a statement, and in exchange
   * a booking can be made as far ahead as somebody wants to plan. A card
   * authorisation lasts seven days; a booking can be thirty days out.
   *
   * A request the host has to answer is only held. That deadline is a day, not
   * thirty — see REQUEST_EXPIRY_HOURS — so the hold comfortably outlives the
   * question, and the two ways it can end without a session are a release
   * rather than a refund: no fee, and nothing on the statement for a booking
   * that never happened.
   */
  capture_method: "automatic" | "manual";
  transfer_group: string;
  metadata: Record<string, string>;
}

/** What the host is later paid, and the only thing they are ever paid. */
export interface HostTransferPlan {
  amount: number;
  currency: "usd";
  destination: string;
  transfer_group: string;
  /**
   * The charge this payout comes out of.
   *
   * Without it a transfer is drawn from the platform's *available* balance, and
   * a card charge does not become available for a couple of working days. A
   * session booked the same morning would then find its own money still
   * settling at the moment the host was due to be paid, and the payout would
   * fail with `balance_insufficient` until it cleared.
   *
   * Naming the charge funds the transfer from that charge specifically, so it
   * goes through whether or not the balance has settled — and it ties the two
   * together in Stripe's records, which is the honest description of what is
   * happening anyway.
   */
  source_transaction: string;
  metadata: Record<string, string>;
}

function moneyMetadata(
  money: BookingMoney,
  metadata: { bookingId: string; spaceId: string; practitionerId: string },
): Record<string, string> {
  return {
    booking_id: metadata.bookingId,
    space_id: metadata.spaceId,
    practitioner_id: metadata.practitionerId,
    // Recorded so a payout dispute can be settled from Stripe alone, without
    // trusting our own database to have remembered correctly.
    host_rate_cents: String(money.hostRateCents),
    service_fee_cents: String(money.serviceFeeCents),
    instant_fee_cents: String(money.instantFeeCents),
    pro_discount_cents: String(money.proDiscountCents),
  };
}

/** Turn a frozen booking quote into the charge Stripe should take. */
export function planPaymentIntent(
  money: BookingMoney,
  metadata: { bookingId: string; spaceId: string; practitionerId: string },
  /** True when the host still has to say yes. Holds the money instead. */
  awaitingApproval = false,
): PaymentIntentPlan {
  if (money.totalCents < money.hostRateCents) {
    // Unreachable through quote(), which floors the platform's cut above
    // Stripe's own fee — but charging the practitioner less than the host is
    // owed would mean topping up the difference from our own balance, silently,
    // on every booking.
    throw new RangeError(
      `total is below the host's rate (total ${money.totalCents}, host ${money.hostRateCents})`,
    );
  }

  return {
    amount: money.totalCents,
    currency: "usd",
    capture_method: awaitingApproval ? "manual" : "automatic",
    transfer_group: transferGroupFor(metadata.bookingId),
    metadata: moneyMetadata(money, metadata),
  };
}

/**
 * What the host is owed once the session has happened.
 *
 * `hostRateCents` and nothing else. The whole fee structure — the service fee,
 * an instant fee, a Pro discount, redeemed credit — lives on the practitioner's
 * side of the transaction and never reaches this number. That is the guarantee
 * the marketplace is built on, and here it is a single field rather than an
 * arithmetic expression that could be got wrong.
 */
export function planHostTransfer(
  money: BookingMoney,
  hostStripeAccountId: string,
  chargeId: string,
  metadata: { bookingId: string; spaceId: string; practitionerId: string },
): HostTransferPlan {
  return {
    amount: money.hostRateCents,
    currency: "usd",
    destination: hostStripeAccountId,
    transfer_group: transferGroupFor(metadata.bookingId),
    source_transaction: chargeId,
    metadata: moneyMetadata(money, metadata),
  };
}

/**
 * What we keep, before Stripe's own processing fee comes out of it.
 *
 * Stripe charges us on the full amount because the full amount lands in our
 * balance now. The host is unaffected by that, which is the point: their rate
 * is transferred whole, and processing is paid out of what is left to us.
 */
export function platformGrossCents(money: BookingMoney): number {
  return money.totalCents - money.hostRateCents;
}

export type SettlementAction =
  | { kind: "refund"; amountCents: number }
  | { kind: "abandon" }
  | { kind: "none" };

/**
 * Map a cancellation outcome onto the Stripe call that realises it.
 *
 * There is no "void" any more. The money is taken when the booking is made, so
 * a cancellation that owes the practitioner nothing is a refund, and one that
 * charges them in full is no action at all.
 *
 * `abandon` is the third case and it is not a refund: a booking cancelled
 * before the payment sheet was ever completed. Nothing was taken, so there is
 * nothing to give back — but the intent is still sitting there waiting for a
 * card, and leaving it would let somebody pay for an hour that no longer
 * exists.
 */
export function settlementFor(
  outcome: { action: "void" | "capture_full"; chargedCents: number },
  paidCents: number,
): SettlementAction {
  if (paidCents === 0) return { kind: "abandon" };

  const owed = outcome.action === "void" ? 0 : outcome.chargedCents;
  const refund = paidCents - owed;

  return refund > 0 ? { kind: "refund", amountCents: refund } : { kind: "none" };
}
