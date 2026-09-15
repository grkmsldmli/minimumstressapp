import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RefundOutcome } from "./refunds";

export type MoneyOperationKind = "payout" | "cancellation" | "refund_request";
export type MoneyOperationState =
  | "claimed"
  | "provider_pending"
  | "committed"
  | "manual_review";

/** The immutable provider instructions returned by the database claim. */
export interface MoneyOperation {
  id: string;
  booking_id: string;
  refund_request_id: string | null;
  kind: MoneyOperationKind;
  state: MoneyOperationState;
  operation_key: string;
  requested_outcome: RefundOutcome | null;
  decision_actor_id: string | null;
  decision_note: string | null;
  cancellation_actor: "practitioner" | "host" | null;
  provider_action: "transfer" | "refund" | "reverse_and_refund" | "cancel_intent" | "none";
  space_id: string;
  practitioner_id: string;
  payment_intent_id: string | null;
  source_transfer_id: string | null;
  destination_account_id: string | null;
  host_rate_cents: number;
  service_fee_cents: number;
  instant_fee_cents: number;
  pro_discount_cents: number;
  total_cents: number;
  platform_cents: number;
  refunded_before_cents: number;
  expected_transfer_cents: number;
  expected_refund_cents: number;
  expected_reversal_cents: number;
  expected_charged_cents: number;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  stripe_reversal_id: string | null;
  provider_status: string | null;
  provider_paid_cents: number | null;
  attempts: number;
  lease_token: string | null;
  lease_until: string | null;
}

function firstOperation(data: unknown): MoneyOperation | null {
  if (!Array.isArray(data)) return null;
  return (data[0] as MoneyOperation | undefined) ?? null;
}

async function claimed(
  result: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<MoneyOperation | null> {
  const { data, error } = await result;
  if (error) throw new Error(error.message ?? "Could not claim the money operation");
  return firstOperation(data);
}

/** A random fencing token belongs to one worker attempt, never to the subject. */
export function moneyLeaseToken(): string {
  return crypto.randomUUID();
}

export async function claimPayout(
  admin: SupabaseClient,
  bookingId: string,
  leaseToken = moneyLeaseToken(),
  now = new Date(),
): Promise<MoneyOperation | null> {
  return claimed(
    admin.rpc("claim_booking_payout", {
      p_booking_id: bookingId,
      p_lease_token: leaseToken,
      p_now: now.toISOString(),
    }),
  );
}

export async function claimCancellation(
  admin: SupabaseClient,
  input: {
    bookingId: string;
    actor: "practitioner" | "host";
    requesterId: string;
    providerAction: "refund" | "cancel_intent" | "none";
    expectedRefundCents: number;
    expectedChargedCents: number;
  },
  leaseToken = moneyLeaseToken(),
  now = new Date(),
): Promise<MoneyOperation | null> {
  return claimed(
    admin.rpc("claim_booking_cancellation", {
      p_booking_id: input.bookingId,
      p_actor: input.actor,
      p_requester_id: input.requesterId,
      p_provider_action: input.providerAction,
      p_expected_refund_cents: input.expectedRefundCents,
      p_expected_charged_cents: input.expectedChargedCents,
      p_lease_token: leaseToken,
      p_now: now.toISOString(),
    }),
  );
}

export async function claimRefundDecision(
  admin: SupabaseClient,
  input: {
    requestId: string;
    decisionActorId: string;
    outcome: RefundOutcome;
    note: string;
  },
  leaseToken = moneyLeaseToken(),
  now = new Date(),
): Promise<MoneyOperation | null> {
  return claimed(
    admin.rpc("claim_refund_decision", {
      p_request_id: input.requestId,
      p_decision_actor_id: input.decisionActorId,
      p_outcome: input.outcome,
      p_note: input.note,
      p_lease_token: leaseToken,
      p_now: now.toISOString(),
    }),
  );
}

export async function claimMoneyOperationRetries(
  admin: SupabaseClient,
  limit = 25,
  worker = moneyLeaseToken(),
  now = new Date(),
): Promise<MoneyOperation[]> {
  const { data, error } = await admin.rpc("claim_booking_money_operation_retries", {
    p_worker: worker,
    p_limit: limit,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(error.message ?? "Could not claim money-operation retries");
  return Array.isArray(data) ? (data as MoneyOperation[]) : [];
}

async function completed(
  result: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<boolean> {
  const { data, error } = await result;
  if (error) throw new Error(error.message ?? "Could not complete the money operation");
  return data === true;
}

export function completePayout(
  admin: SupabaseClient,
  operation: MoneyOperation,
  transferId: string,
  now = new Date(),
): Promise<boolean> {
  return completed(
    admin.rpc("complete_booking_payout", {
      p_operation_id: operation.id,
      p_lease_token: operation.lease_token,
      p_transfer_id: transferId,
      p_now: now.toISOString(),
    }),
  );
}

export function completeCancellation(
  admin: SupabaseClient,
  operation: MoneyOperation,
  result: {
    refundId: string | null;
    providerStatus: string;
    paymentIntentStatus: string;
    paidCents: number;
    refundedCents: number;
  },
  now = new Date(),
): Promise<boolean> {
  return completed(
    admin.rpc("complete_booking_cancellation", {
      p_operation_id: operation.id,
      p_lease_token: operation.lease_token,
      p_refund_id: result.refundId,
      p_provider_status: result.providerStatus,
      p_payment_intent_status: result.paymentIntentStatus,
      p_paid_cents: result.paidCents,
      p_refunded_cents: result.refundedCents,
      p_now: now.toISOString(),
    }),
  );
}

export function completeRefundDecision(
  admin: SupabaseClient,
  operation: MoneyOperation,
  result: {
    refundId: string;
    reversalId: string | null;
    providerStatus: string;
    refundedCents: number;
  },
  now = new Date(),
): Promise<boolean> {
  return completed(
    admin.rpc("complete_refund_decision", {
      p_operation_id: operation.id,
      p_lease_token: operation.lease_token,
      p_refund_id: result.refundId,
      p_reversal_id: result.reversalId,
      p_provider_status: result.providerStatus,
      p_refunded_cents: result.refundedCents,
      p_now: now.toISOString(),
    }),
  );
}

/**
 * Persist only a controlled operational message. Stripe request payloads,
 * customer details and SDK error objects never enter the database or response.
 */
export async function failMoneyOperation(
  admin: SupabaseClient,
  operation: MoneyOperation,
  message: string,
  manualReview: boolean,
  now = new Date(),
): Promise<boolean> {
  return completed(
    admin.rpc("fail_booking_money_operation", {
      p_operation_id: operation.id,
      p_lease_token: operation.lease_token,
      p_error: message,
      p_manual_review: manualReview,
      p_now: now.toISOString(),
    }),
  );
}
