import "server-only";

import type { StripeGateway } from "../booking-service";
import {
  captureHold,
  chargeBooking,
  payHost,
  paymentIntentSettlementState,
  releaseHold,
  settle,
} from "../stripe/client";
import { settlementFor } from "../stripe/payments";

/**
 * Adapts the Stripe client to the narrow interface `booking-service` asks for.
 *
 * The service depends on this shape rather than on Stripe directly, which is
 * what lets the booking rules be tested without a network — and what would let
 * a second processor slot in without touching the money logic.
 */
export const stripeGateway: StripeGateway = {
  charge: (money, meta, customerId, awaitingApproval) =>
    chargeBooking(money, meta, customerId, awaitingApproval),

  capture: (paymentIntentId, bookingId) => captureHold(paymentIntentId, bookingId),

  release: (paymentIntentId, idempotencyKey?: string) =>
    releaseHold(paymentIntentId, idempotencyKey),

  settle: async (paymentIntentId, paidCents, outcome, idempotencyKey?: string) =>
    settlementFor(outcome, paidCents).kind === "none"
      ? { refundedCents: 0, paidCents }
      : settleAndReport(paymentIntentId, paidCents, outcome, idempotencyKey),

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
  idempotencyKey?: string,
): Promise<{ refundedCents: number; paidCents: number }> {
  const action = settlementFor(outcome, paidCents);
  try {
    await settle(paymentIntentId, action, providerOperationKey(idempotencyKey, action.kind));
  } catch (failure) {
    if (action.kind !== "abandon") throw failure;

    /*
     * Postgres may still say "uncaptured" while Stripe has just completed a
     * capture. Re-read the provider rather than turning that ordinary webhook
     * race into a manual-review dead end. The same stable operation key is
     * used if provider truth changes the action from cancel to refund.
     */
    let state: Awaited<ReturnType<typeof paymentIntentSettlementState>>;
    try {
      state = await paymentIntentSettlementState(paymentIntentId);
    } catch {
      throw failure;
    }

    if (state.status === "canceled") return { refundedCents: 0, paidCents: 0 };
    if (state.amountReceivedCents <= 0) throw failure;

    const reconciled = settlementFor(outcome, state.amountReceivedCents);
    await settle(
      paymentIntentId,
      reconciled,
      providerOperationKey(idempotencyKey, reconciled.kind),
    );
    return {
      refundedCents: reconciled.kind === "refund" ? reconciled.amountCents : 0,
      paidCents: state.amountReceivedCents,
    };
  }

  return {
    refundedCents: action.kind === "refund" ? action.amountCents : 0,
    paidCents,
  };
}

/** Stripe idempotency keys are scoped to the exact endpoint and parameters. */
function providerOperationKey(
  base: string | undefined,
  action: "abandon" | "refund" | "none",
): string | undefined {
  return base && action !== "none" ? `${base}:${action}` : base;
}
