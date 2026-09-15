import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveCancellation,
  type BookingMoney,
  type CancellationOutcome,
} from "./money";

const LEASE_MS = 15 * 60_000;
const MAX_ATTEMPTS = 12;
const MAX_BATCH = 100;
const WORKERS = 5;

export type FinancialResolutionState =
  | "not_required"
  | "pending"
  | "resolved"
  | "manual_review";

export interface FinancialResolutionPatch {
  financial_resolution_state: FinancialResolutionState;
  financial_resolution_attempts: number;
  financial_resolution_next_attempt_at: string | null;
  financial_resolution_last_error: string | null;
  financial_resolved_at: string | null;
  financial_resolution_lease_token: string | null;
  financial_resolution_lease_until: string | null;
}

export interface InitialFinancialResolution {
  patch: FinancialResolutionPatch;
  leaseToken: string | null;
}

/**
 * The financial state written in the same database update that closes a
 * booking. That ordering makes every Stripe action recoverable: the row says
 * what remains to be done before the provider is called.
 */
export function initialFinancialResolution(
  hasPaymentIntent: boolean,
  now = new Date()
): InitialFinancialResolution {
  return financialResolutionPatch(hasPaymentIntent, now);
}

/** Same initializer with an injectable token for callers that own a transaction. */
export function financialResolutionPatch(
  hasPaymentIntent: boolean,
  now = new Date(),
  requestedLeaseToken: string = randomUUID()
): InitialFinancialResolution {
  if (!hasPaymentIntent) {
    return {
      leaseToken: null,
      patch: {
        financial_resolution_state: "resolved",
        financial_resolution_attempts: 0,
        financial_resolution_next_attempt_at: null,
        financial_resolution_last_error: null,
        financial_resolved_at: now.toISOString(),
        financial_resolution_lease_token: null,
        financial_resolution_lease_until: null,
      },
    };
  }

  const leaseToken = requestedLeaseToken;
  return {
    leaseToken,
    patch: {
      financial_resolution_state: "pending",
      financial_resolution_attempts: 1,
      financial_resolution_next_attempt_at: now.toISOString(),
      financial_resolution_last_error: null,
      financial_resolved_at: null,
      financial_resolution_lease_token: leaseToken,
      financial_resolution_lease_until: new Date(
        now.getTime() + LEASE_MS
      ).toISOString(),
    },
  };
}

export interface FinancialResolutionRow {
  id: string;
  stripe_payment_intent_id: string | null;
  approval_state: string;
  cancelled_by: "practitioner" | "host" | null;
  cancelled_at: string | null;
  starts_at: string;
  captured_at: string | null;
  was_pro: boolean | null;
  host_rate_cents: number;
  service_fee_cents: number;
  instant_fee_cents: number;
  pro_discount_cents: number;
  total_cents: number;
  platform_cents: number;
  /** Alias returned by claim_booking_financial_resolution_batch. */
  attempts: number;
  /** Alias returned by claim_booking_financial_resolution_batch. */
  lease_token: string;
}

/**
 * One PostgREST projection shared by the immediate cancel/decline paths.
 * Aliasing the private bookkeeping columns keeps those callers on the same
 * shape returned by the retry RPC.
 */
export const FINANCIAL_RESOLUTION_SELECT =
  "id,stripe_payment_intent_id,approval_state,cancelled_by,cancelled_at,starts_at,captured_at,was_pro,host_rate_cents,service_fee_cents,instant_fee_cents,pro_discount_cents,total_cents,platform_cents,attempts:financial_resolution_attempts,lease_token:financial_resolution_lease_token" as const;

/** Narrow boundary used by both the live Stripe adapter and tests. */
export interface FinancialStripeGateway {
  capture(paymentIntentId: string, bookingId: string): Promise<void>;
  settle(
    paymentIntentId: string,
    paidCents: number,
    outcome: CancellationOutcome,
    idempotencyKey: string
  ): Promise<{ refundedCents: number; paidCents?: number }>;
  release(paymentIntentId: string, idempotencyKey: string): Promise<void>;
}

export class FinancialResolutionError extends Error {
  constructor(
    message: string,
    readonly disposition: "retry" | "manual_review" | "unknown"
  ) {
    super(message);
    this.name = "FinancialResolutionError";
  }
}

export function cancellationFinancialIdempotencyKey(bookingId: string): string {
  return `booking_financial_cancellation_${bookingId}`;
}

export function requestHoldFinancialIdempotencyKey(bookingId: string): string {
  return `booking_financial_hold_release_${bookingId}`;
}

/**
 * Capture an approved request under the same durable lease used by every
 * other booking-side money transition. A signed succeeded webhook is already
 * sufficient proof, so a crash after capture but before finalization does not
 * require another provider mutation.
 */
export async function resolveApprovalCaptureFinancial(
  admin: SupabaseClient,
  stripe: FinancialStripeGateway,
  row: FinancialResolutionRow,
  leaseToken: string,
  now = new Date(),
): Promise<{ refundedCents: 0 }> {
  if (!row.stripe_payment_intent_id || !isApprovalCapture(row)) {
    await failInvalidClaim(admin, row, leaseToken);
    throw new FinancialResolutionError(
      "Financial resolution requires manual review",
      "manual_review",
    );
  }

  try {
    if (!row.captured_at) {
      await stripe.capture(row.stripe_payment_intent_id, row.id);
    }
    await finalize(admin, row, leaseToken, now, 0);
    return { refundedCents: 0 };
  } catch (failure) {
    if (failure instanceof FinancialResolutionError) throw failure;
    const disposition = await recordProviderFailure(
      admin,
      row,
      leaseToken,
      failure,
      now,
    );
    throw new FinancialResolutionError(
      disposition === "manual_review"
        ? "Financial resolution requires manual review"
        : "Financial resolution is queued for retry",
      disposition,
    );
  }
}

/**
 * Settle a cancelled booking and finalize only while this caller still owns
 * its lease. A retry always presents the same provider idempotency key.
 */
export async function resolveCancellationFinancial(
  admin: SupabaseClient,
  stripe: FinancialStripeGateway,
  row: FinancialResolutionRow,
  leaseToken: string,
  now = new Date()
): Promise<{ refundedCents: number; chargedCents: number }> {
  const money = moneyFrom(row);
  const sessionStart = new Date(row.starts_at);
  if (
    !row.stripe_payment_intent_id ||
    Number.isNaN(sessionStart.getTime()) ||
    !row.cancelled_by
  ) {
    await failInvalidClaim(admin, row, leaseToken);
    throw new FinancialResolutionError(
      "Financial resolution requires manual review",
      "manual_review"
    );
  }
  const paymentIntentId = row.stripe_payment_intent_id;

  const outcome = resolveCancellation(
    money,
    row.cancelled_by,
    sessionStart,
    cancellationInstant(row, now),
    Boolean(row.was_pro)
  );

  try {
    const result = await stripe.settle(
      paymentIntentId,
      row.captured_at ? row.total_cents : 0,
      outcome,
      cancellationFinancialIdempotencyKey(row.id)
    );

    const paidCents = result.paidCents ?? (row.captured_at ? row.total_cents : 0);
    await finalize(admin, row, leaseToken, now, result.refundedCents, paidCents);
    return {
      refundedCents: result.refundedCents,
      chargedCents: Math.max(0, paidCents - result.refundedCents),
    };
  } catch (failure) {
    if (failure instanceof FinancialResolutionError) throw failure;
    const disposition = await recordProviderFailure(
      admin,
      row,
      leaseToken,
      failure,
      now
    );
    throw new FinancialResolutionError(
      disposition === "manual_review"
        ? "Financial resolution requires manual review"
        : "Financial resolution is queued for retry",
      disposition
    );
  }
}

/**
 * Release an authorization for a declined or expired request. Nothing was
 * captured, so this never writes refund figures.
 */
export async function resolveRequestHoldFinancial(
  admin: SupabaseClient,
  stripe: FinancialStripeGateway,
  row: FinancialResolutionRow,
  leaseToken: string,
  now = new Date()
): Promise<{ refundedCents: 0 }> {
  if (!row.stripe_payment_intent_id || !isRequestHold(row)) {
    await failInvalidClaim(admin, row, leaseToken);
    throw new FinancialResolutionError(
      "Financial resolution requires manual review",
      "manual_review"
    );
  }
  const paymentIntentId = row.stripe_payment_intent_id;

  try {
    await stripe.release(
      paymentIntentId,
      requestHoldFinancialIdempotencyKey(row.id)
    );
    await finalize(admin, row, leaseToken, now, 0);
    return { refundedCents: 0 };
  } catch (failure) {
    if (failure instanceof FinancialResolutionError) throw failure;
    const disposition = await recordProviderFailure(
      admin,
      row,
      leaseToken,
      failure,
      now
    );
    throw new FinancialResolutionError(
      disposition === "manual_review"
        ? "Financial resolution requires manual review"
        : "Financial resolution is queued for retry",
      disposition
    );
  }
}

export interface FinancialResolutionRetryResult {
  claimed: number;
  resolved: number;
  retrying: number;
  manualReview: number;
}

/**
 * Claim and resolve due financial work with a bounded pool. The worker changes
 * only financial facts on the booking; lifecycle notifications are reconciled
 * separately after those facts become durable.
 */
export async function retryFinancialResolutions(
  admin: SupabaseClient,
  stripe: FinancialStripeGateway,
  limit = 20,
  now = new Date()
): Promise<FinancialResolutionRetryResult> {
  const worker = randomUUID();
  const boundedLimit = Math.max(1, Math.min(MAX_BATCH, Math.trunc(limit) || 1));
  const { data, error } = await admin.rpc(
    "claim_booking_financial_resolution_batch",
    {
      p_worker: worker,
      p_limit: boundedLimit,
      p_now: now.toISOString(),
    }
  );
  if (error) {
    throw new FinancialResolutionError(
      "Could not claim financial resolutions",
      "unknown"
    );
  }

  const rows = (data ?? []) as FinancialResolutionRow[];
  const result: FinancialResolutionRetryResult = {
    claimed: rows.length,
    resolved: 0,
    retrying: 0,
    manualReview: 0,
  };

  let cursor = 0;
  const work = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        if (!row.stripe_payment_intent_id) {
          await failInvalidClaim(admin, row, row.lease_token);
          result.manualReview += 1;
          continue;
        }

        if (isApprovalCapture(row)) {
          await resolveApprovalCaptureFinancial(
            admin,
            stripe,
            row,
            row.lease_token,
            now,
          );
        } else if (isRequestHold(row)) {
          await resolveRequestHoldFinancial(
            admin,
            stripe,
            row,
            row.lease_token,
            now
          );
        } else if (isCancellation(row)) {
          await resolveCancellationFinancial(
            admin,
            stripe,
            row,
            row.lease_token,
            now
          );
        } else {
          await failInvalidClaim(admin, row, row.lease_token);
          result.manualReview += 1;
          continue;
        }
        result.resolved += 1;
      } catch (failure) {
        if (
          failure instanceof FinancialResolutionError &&
          failure.disposition === "manual_review"
        ) {
          result.manualReview += 1;
        } else {
          result.retrying += 1;
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(WORKERS, rows.length) }, () => work())
  );
  return result;
}

function moneyFrom(row: FinancialResolutionRow): BookingMoney {
  return {
    hostRateCents: row.host_rate_cents,
    serviceFeeCents: row.service_fee_cents,
    instantFeeCents: row.instant_fee_cents,
    proDiscountCents: row.pro_discount_cents,
    totalCents: row.total_cents,
    platformCents: row.platform_cents,
  };
}

function isRequestHold(row: FinancialResolutionRow): boolean {
  return (
    row.cancelled_by === null &&
    row.cancelled_at !== null &&
    (row.approval_state === "declined" || row.approval_state === "expired")
  );
}

function isApprovalCapture(row: FinancialResolutionRow): boolean {
  return (
    row.approval_state === "approved" &&
    row.cancelled_by === null &&
    row.cancelled_at === null
  );
}

function isCancellation(row: FinancialResolutionRow): boolean {
  return (
    row.cancelled_at !== null &&
    (row.cancelled_by === "practitioner" || row.cancelled_by === "host")
  );
}

/**
 * Cancellation price is frozen when the cancellation row is written. The
 * claim RPC returns that timestamp, so a delayed retry cannot cross the
 * 24-hour boundary and change what the practitioner owes.
 */
function cancellationInstant(
  row: FinancialResolutionRow,
  fallback: Date
): Date {
  const cancelledAt = row.cancelled_at ? new Date(row.cancelled_at) : fallback;
  return Number.isNaN(cancelledAt.getTime()) ? fallback : cancelledAt;
}

async function finalize(
  admin: SupabaseClient,
  row: FinancialResolutionRow,
  leaseToken: string,
  now: Date,
  refundedCents: number,
  paidCents = 0,
): Promise<void> {
  const patch: Record<string, unknown> = {
    // The slot remains blocked while provider truth is unresolved. This is the
    // only write that frees it, after Stripe has confirmed the refund/release.
    status: isApprovalCapture(row)
      ? "upcoming"
      : row.cancelled_by === "practitioner"
        ? "cancelled_by_practitioner"
        : "cancelled_by_host",
    financial_resolution_state: "resolved",
    financial_resolution_next_attempt_at: null,
    financial_resolution_last_error: null,
    financial_resolved_at: now.toISOString(),
    financial_resolution_lease_token: null,
    financial_resolution_lease_until: null,
  };
  if (isApprovalCapture(row)) {
    // A successful capture response (or a retrieve that proves `succeeded`)
    // is provider truth too. Persist it here instead of depending forever on
    // a later webhook delivery before the booking can send its receipt.
    patch.captured_at = row.captured_at ?? now.toISOString();
  }
  if (isCancellation(row) && paidCents > 0 && !row.captured_at) {
    // Capture can win while cancellation is being claimed. If Stripe's
    // recovery read proves money arrived, retain that fact before closing the
    // booking so reconciliation and receipts do not describe it as unpaid.
    patch.captured_at = now.toISOString();
  }
  if (refundedCents > 0) {
    patch.refunded_cents = refundedCents;
    patch.refunded_at = now.toISOString();
  }

  await fencedUpdate(admin, row.id, leaseToken, patch);
}

async function recordProviderFailure(
  admin: SupabaseClient,
  row: FinancialResolutionRow,
  leaseToken: string,
  failure: unknown,
  now: Date
): Promise<"retry" | "manual_review"> {
  const controlled = controlledProviderError(failure);
  const terminal = controlled.permanent || row.attempts >= MAX_ATTEMPTS;
  await fencedUpdate(admin, row.id, leaseToken, {
    financial_resolution_state: terminal ? "manual_review" : "pending",
    financial_resolution_next_attempt_at: terminal
      ? null
      : nextAttemptAt(row.attempts, now),
    financial_resolution_last_error: controlled.code,
    financial_resolved_at: null,
    financial_resolution_lease_token: null,
    financial_resolution_lease_until: null,
  });
  return terminal ? "manual_review" : "retry";
}

async function failInvalidClaim(
  admin: SupabaseClient,
  row: Pick<FinancialResolutionRow, "id">,
  leaseToken: string
): Promise<void> {
  await fencedUpdate(admin, row.id, leaseToken, {
    financial_resolution_state: "manual_review",
    financial_resolution_next_attempt_at: null,
    financial_resolution_last_error: "invalid_financial_resolution_state",
    financial_resolved_at: null,
    financial_resolution_lease_token: null,
    financial_resolution_lease_until: null,
  });
}

async function fencedUpdate(
  admin: SupabaseClient,
  bookingId: string,
  leaseToken: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { data, error } = await admin
    .from("bookings")
    .update(patch)
    .eq("id", bookingId)
    .eq("financial_resolution_lease_token", leaseToken)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new FinancialResolutionError(
      "Could not record financial resolution",
      "unknown"
    );
  }
  if (!data) {
    throw new FinancialResolutionError(
      "Financial resolution lease was lost",
      "unknown"
    );
  }
}

function nextAttemptAt(attempts: number, from: Date): string {
  const minutes = Math.min(6 * 60, 2 ** Math.max(0, attempts - 1));
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function controlledProviderError(failure: unknown): {
  code: string;
  permanent: boolean;
} {
  const record =
    failure && typeof failure === "object"
      ? (failure as Record<string, unknown>)
      : {};
  const code = typeof record.code === "string" ? record.code : "";
  const type = typeof record.type === "string" ? record.type : "";

  if (code === "resource_missing") {
    return { code: "stripe_payment_intent_missing", permanent: true };
  }
  if (code === "payment_intent_unexpected_state") {
    // Capture and cancellation can cross in flight. The signed Stripe webhook
    // may still stamp `captured_at`, after which the same stable operation can
    // be recomputed and retried safely.
    return { code: "stripe_payment_intent_state_conflict", permanent: false };
  }
  if (type === "StripeRateLimitError" || type === "rate_limit_error") {
    return { code: "stripe_rate_limited", permanent: false };
  }
  if (type === "StripeConnectionError" || type === "api_connection_error") {
    return { code: "stripe_unavailable", permanent: false };
  }
  return { code: "stripe_financial_resolution_failed", permanent: false };
}
