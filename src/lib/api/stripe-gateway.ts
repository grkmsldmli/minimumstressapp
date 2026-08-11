import "server-only";

import type { StripeGateway } from "../booking-service";
import { chargeBooking, payHost, settle } from "../stripe/client";
import { settlementFor } from "../stripe/payments";

/**
 * Adapts the Stripe client to the narrow interface `booking-service` asks for.
 *
 * The service depends on this shape rather than on Stripe directly, which is
 * what lets the booking rules be tested without a network — and what would let
 * a second processor slot in without touching the money logic.
 */
export const stripeGateway: StripeGateway = {
  charge: (money, meta, customerId) => chargeBooking(money, meta, customerId),

  settle: async (paymentIntentId, paidCents, outcome) =>
    settlementFor(outcome, paidCents).kind === "none"
      ? { refundedCents: 0 }
      : settleAndReport(paymentIntentId, paidCents, outcome),

  payHost: (money, hostAccountId, paymentIntentId, meta) =>
    payHost(money, hostAccountId, paymentIntentId, meta),
};

/**
 * Runs the settlement and reports what came back, because the caller has to
 * write that number down. Splitting it out keeps the "nothing happened" case
 * from having to pretend it made a call.
 */
async function settleAndReport(
  paymentIntentId: string,
  paidCents: number,
  outcome: { action: "void" | "capture_full"; chargedCents: number },
): Promise<{ refundedCents: number }> {
  const action = settlementFor(outcome, paidCents);
  await settle(paymentIntentId, action);

  return { refundedCents: action.kind === "refund" ? action.amountCents : 0 };
}
