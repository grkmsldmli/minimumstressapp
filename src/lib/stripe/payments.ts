/**
 * How a booking becomes money.
 *
 * Destination charges: the practitioner pays us, Stripe transfers the host's
 * share to their connected account, and we keep an application fee. The whole
 * arrangement rests on one line — `application_fee_amount` — so that is derived
 * from the quote rather than typed by hand anywhere.
 *
 * Pure functions here, no network. The Stripe calls live in `client.ts`; this
 * file is the part worth testing, because getting the fee wrong silently
 * underpays a host on every booking.
 */

import type { BookingMoney } from "../money";

/** What Stripe is told to do at booking time. */
export interface PaymentIntentPlan {
  /** Total authorised on the practitioner's card, in cents. */
  amount: number;
  currency: "usd";
  /**
   * Held, not taken. This is what makes 24-hour free cancellation possible:
   * until capture, no money has moved and voiding costs the practitioner
   * nothing.
   */
  capture_method: "manual";
  /** The host's connected account. */
  transfer_data: { destination: string };
  /**
   * Our cut. Stripe pays the destination `amount - application_fee_amount`, so
   * this is the only number standing between a host and their rate.
   */
  application_fee_amount: number;
  metadata: Record<string, string>;
}

/**
 * Turn a frozen booking quote into Stripe's shape.
 *
 * `application_fee_amount` is computed as total minus the host's rate rather
 * than as "the platform's cut", even though the two are equal. Written this
 * way the host's take is the subject of the arithmetic: whatever else changes —
 * an instant fee, a Pro discount, redeemed credit — the destination still
 * receives exactly `hostRateCents`, because that is what the expression says.
 */
export function planPaymentIntent(
  money: BookingMoney,
  hostStripeAccountId: string,
  metadata: { bookingId: string; spaceId: string; practitionerId: string },
): PaymentIntentPlan {
  const applicationFee = money.totalCents - money.hostRateCents;

  if (applicationFee < 0) {
    // Unreachable through quote(), which floors the platform's cut above
    // Stripe's own fee — but a negative application fee would mean charging
    // the practitioner less than the host is owed and topping up the
    // difference from our own balance, silently, on every booking.
    throw new RangeError(
      `application fee would be negative (total ${money.totalCents}, host ${money.hostRateCents})`,
    );
  }

  return {
    amount: money.totalCents,
    currency: "usd",
    capture_method: "manual",
    transfer_data: { destination: hostStripeAccountId },
    application_fee_amount: applicationFee,
    metadata: {
      booking_id: metadata.bookingId,
      space_id: metadata.spaceId,
      practitioner_id: metadata.practitionerId,
      // Recorded so a payout dispute can be settled from Stripe alone, without
      // trusting our own database to have remembered correctly.
      host_rate_cents: String(money.hostRateCents),
      service_fee_cents: String(money.serviceFeeCents),
      instant_fee_cents: String(money.instantFeeCents),
      pro_discount_cents: String(money.proDiscountCents),
      credit_applied_cents: String(money.creditAppliedCents),
    },
  };
}

/**
 * What the host actually receives.
 *
 * Verified against the sandbox rather than inferred, because the obvious field
 * lies: on the platform's copy of the charge, `transfer.amount` reads as the
 * full 5900, which looks alarmingly like the host being handed our fee too. It
 * is not. The application fee is deducted on the connected account's side, and
 * that account's own ledger is the honest view:
 *
 *     payment   amount 5900   fee 1400   net 4500
 *
 * For a $45.00 rate on an instant slot: the practitioner pays $59.00, the host
 * receives exactly $45.00, Stripe takes $2.01, and $11.99 reaches us. Anyone
 * checking this in the dashboard should look at the connected account's
 * balance, not the platform's transfer record.
 */
export function hostReceivesCents(plan: PaymentIntentPlan): number {
  return plan.amount - plan.application_fee_amount;
}

export type SettlementAction =
  | { kind: "capture"; amountCents: number }
  | { kind: "void" }
  | { kind: "refund"; amountCents: number }
  | { kind: "none" };

/**
 * Map a cancellation outcome onto the Stripe call that realises it.
 *
 * The distinction between void and refund is not cosmetic. Before capture
 * there is no charge, so cancelling releases the hold and the practitioner
 * never sees a line on their statement. After capture the money has moved and
 * only a refund brings it back — visible, slower, and reversing a transfer the
 * host may already have been paid.
 *
 * `capturedCents` is a separate argument rather than read off the outcome
 * because a cancellation that releases the money reports `chargedCents: 0` —
 * correct as a statement of what the practitioner owes, useless as a refund
 * amount. Refunding zero would leave a host cancellation quietly keeping the
 * practitioner's money.
 */
export function settlementFor(
  outcome: { action: "void" | "capture_full"; chargedCents: number },
  capturedCents: number,
): SettlementAction {
  const alreadyCaptured = capturedCents > 0;

  if (outcome.action === "capture_full") {
    // Capturing something already captured would double-charge.
    return alreadyCaptured ? { kind: "none" } : { kind: "capture", amountCents: outcome.chargedCents };
  }

  if (!alreadyCaptured) return { kind: "void" };
  return { kind: "refund", amountCents: capturedCents };
}
