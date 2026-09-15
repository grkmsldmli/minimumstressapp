import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  completeCancellation,
  completePayout,
  completeRefundDecision,
  failMoneyOperation,
  type MoneyOperation,
} from "./money-operations";
import { notifyCancellation, notifyHostPayoutSent } from "./notify/for-booking";
import { notifyRefundDecided } from "./notify/for-refund";
import {
  payHost,
  refundRequested,
  settleClaimedCancellation,
  StripeReconciliationError,
  type CancellationSettlementResult,
} from "./stripe/client";

export interface MoneyProvider {
  payout(operation: MoneyOperation): Promise<{ transferId: string }>;
  cancellation(operation: MoneyOperation): Promise<CancellationSettlementResult>;
  refund(operation: MoneyOperation): Promise<{
    refundId: string;
    reversalId: string | null;
    providerStatus: string;
    refundedCents: number;
  }>;
}

export const stripeMoneyProvider: MoneyProvider = {
  payout: (operation) => {
    if (!operation.destination_account_id || !operation.payment_intent_id) {
      throw new StripeReconciliationError("The payout claim is missing provider inputs", true);
    }
    return payHost(
      {
        hostRateCents: operation.host_rate_cents,
        serviceFeeCents: operation.service_fee_cents,
        instantFeeCents: operation.instant_fee_cents,
        proDiscountCents: operation.pro_discount_cents,
        totalCents: operation.total_cents,
        platformCents: operation.platform_cents,
      },
      operation.destination_account_id,
      operation.payment_intent_id,
      {
        bookingId: operation.booking_id,
        spaceId: operation.space_id,
        practitionerId: operation.practitioner_id,
        moneyOperationId: operation.id,
        knownTransferId: operation.stripe_transfer_id,
      },
    );
  },

  cancellation: (operation) =>
    settleClaimedCancellation(operation.payment_intent_id, operation.expected_refund_cents, {
      operationId: operation.id,
      bookingId: operation.booking_id,
      operationKind: "cancellation",
      knownRefundId: operation.stripe_refund_id,
    }),

  async refund(operation) {
    if (!operation.payment_intent_id || !operation.refund_request_id) {
      throw new StripeReconciliationError("The refund claim is missing provider inputs", true);
    }
    return refundRequested(
      operation.payment_intent_id,
      operation.expected_refund_cents,
      operation.source_transfer_id,
      operation.expected_reversal_cents,
      operation.refund_request_id,
      {
        operationId: operation.id,
        bookingId: operation.booking_id,
        knownRefundId: operation.stripe_refund_id,
        knownReversalId: operation.stripe_reversal_id,
      },
    );
  },
};

export class MoneyOperationExecutionError extends Error {
  constructor(readonly manualReview: boolean) {
    super(
      manualReview
        ? "The provider record needs manual review before this money operation can continue"
        : "The money operation could not be confirmed and remains queued for retry",
    );
  }
}

/**
 * Executes one already-claimed operation and fences its database completion.
 * Notification is deliberately outside the provider try/catch: money is final
 * before any success email can be claimed, and an email failure must never
 * turn into a second provider mutation.
 */
export async function executeMoneyOperation(
  admin: SupabaseClient,
  operation: MoneyOperation,
  provider: MoneyProvider = stripeMoneyProvider,
  now = new Date(),
): Promise<{ committed: boolean; refundedCents: number }> {
  if (operation.state === "committed") {
    await notifyCommitted(
      admin,
      operation,
      operation.expected_refund_cents,
      operation.provider_paid_cents ?? 0,
    );
    return { committed: true, refundedCents: operation.expected_refund_cents };
  }
  if (!operation.lease_token) throw new MoneyOperationExecutionError(true);

  let committed = false;
  let refundedCents = 0;
  let paidCents = 0;

  try {
    switch (operation.kind) {
      case "payout": {
        const result = await provider.payout(operation);
        committed = await completePayout(admin, operation, result.transferId, now);
        break;
      }
      case "cancellation": {
        const result = await provider.cancellation(operation);
        paidCents = result.paidCents;
        refundedCents = result.refundedCents;
        committed = await completeCancellation(admin, operation, result, now);
        break;
      }
      case "refund_request": {
        const result = await provider.refund(operation);
        refundedCents = result.refundedCents;
        committed = await completeRefundDecision(admin, operation, result, now);
        break;
      }
    }
  } catch (failure) {
    const manualReview =
      failure instanceof StripeReconciliationError && failure.manualReview;
    const message = manualReview
      ? "Stripe records conflict with the claimed money operation"
      : "Stripe did not confirm the claimed money operation";
    await failMoneyOperation(admin, operation, message, manualReview, now).catch(() => false);
    throw new MoneyOperationExecutionError(manualReview);
  }

  if (committed) await notifyCommitted(admin, operation, refundedCents, paidCents);
  return { committed, refundedCents };
}

async function notifyCommitted(
  admin: SupabaseClient,
  operation: MoneyOperation,
  refundedCents: number,
  paidCents: number,
): Promise<void> {
  switch (operation.kind) {
    case "payout":
      await notifyHostPayoutSent(admin, operation.booking_id).catch(() => {});
      return;
    case "refund_request":
      if (operation.refund_request_id) {
        await notifyRefundDecided(admin, operation.refund_request_id).catch(() => {});
      }
      return;
    case "cancellation":
      if (operation.cancellation_actor) {
        await notifyCancellation(admin, operation.booking_id, operation.cancellation_actor, {
          chargedCents: Math.max(0, paidCents - refundedCents),
          refundedCents,
        }).catch(() => {});
      }
  }
}
