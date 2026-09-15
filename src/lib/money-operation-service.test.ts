import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class FakeStripeReconciliationError extends Error {
    constructor(message: string, readonly manualReview: boolean) {
      super(message);
    }
  }
  return {
    completeCancellation: vi.fn(),
    completePayout: vi.fn(),
    completeRefundDecision: vi.fn(),
    failMoneyOperation: vi.fn(),
    notifyCancellation: vi.fn(),
    notifyHostPayoutSent: vi.fn(),
    notifyRefundDecided: vi.fn(),
    payHost: vi.fn(),
    refundRequested: vi.fn(),
    settleClaimedCancellation: vi.fn(),
    StripeReconciliationError: FakeStripeReconciliationError,
  };
});

vi.mock("./money-operations", () => ({
  completeCancellation: mocks.completeCancellation,
  completePayout: mocks.completePayout,
  completeRefundDecision: mocks.completeRefundDecision,
  failMoneyOperation: mocks.failMoneyOperation,
}));
vi.mock("./notify/for-booking", () => ({
  notifyCancellation: mocks.notifyCancellation,
  notifyHostPayoutSent: mocks.notifyHostPayoutSent,
}));
vi.mock("./notify/for-refund", () => ({
  notifyRefundDecided: mocks.notifyRefundDecided,
}));
vi.mock("./stripe/client", () => ({
  payHost: mocks.payHost,
  refundRequested: mocks.refundRequested,
  settleClaimedCancellation: mocks.settleClaimedCancellation,
  StripeReconciliationError: mocks.StripeReconciliationError,
}));

import {
  executeMoneyOperation,
  MoneyOperationExecutionError,
  type MoneyProvider,
} from "./money-operation-service";
import type { MoneyOperation } from "./money-operations";

const operation: MoneyOperation = {
  id: "op_1",
  booking_id: "booking_1",
  refund_request_id: null,
  kind: "cancellation",
  state: "claimed",
  operation_key: "booking:booking_1:cancellation",
  requested_outcome: null,
  decision_actor_id: null,
  decision_note: null,
  cancellation_actor: "host",
  provider_action: "refund",
  space_id: "space_1",
  practitioner_id: "practitioner_1",
  payment_intent_id: "pi_1",
  source_transfer_id: null,
  destination_account_id: null,
  host_rate_cents: 4_000,
  service_fee_cents: 500,
  instant_fee_cents: 0,
  pro_discount_cents: 0,
  total_cents: 4_500,
  platform_cents: 500,
  refunded_before_cents: 0,
  expected_transfer_cents: 0,
  expected_refund_cents: 4_500,
  expected_reversal_cents: 0,
  expected_charged_cents: 0,
  stripe_transfer_id: null,
  stripe_refund_id: null,
  stripe_reversal_id: null,
  provider_status: null,
  provider_paid_cents: null,
  attempts: 1,
  lease_token: "lease_1",
  lease_until: "2026-09-15T12:10:00.000Z",
};

const cancellationResult = {
  refundId: "re_1",
  providerStatus: "succeeded",
  paymentIntentStatus: "succeeded",
  paidCents: 4_500,
  refundedCents: 4_500,
};

function provider(): MoneyProvider {
  return {
    payout: vi.fn(),
    cancellation: vi.fn().mockResolvedValue(cancellationResult),
    refund: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failMoneyOperation.mockResolvedValue(true);
  mocks.notifyCancellation.mockResolvedValue(undefined);
});

describe("money operation commit and notification ordering", () => {
  it("does not emit a success receipt when provider truth is not durably committed", async () => {
    mocks.completeCancellation.mockResolvedValue(false);

    await expect(executeMoneyOperation({} as never, operation, provider())).resolves.toEqual({
      committed: false,
      refundedCents: 4_500,
    });
    expect(mocks.notifyCancellation).not.toHaveBeenCalled();
  });

  it("emits the receipt only after the fenced completion succeeds", async () => {
    const order: string[] = [];
    mocks.completeCancellation.mockImplementation(async () => {
      order.push("durable-completion");
      return true;
    });
    mocks.notifyCancellation.mockImplementation(async () => {
      order.push("notification");
    });

    await executeMoneyOperation({} as never, operation, provider());
    expect(order).toEqual(["durable-completion", "notification"]);
    expect(mocks.notifyCancellation).toHaveBeenCalledWith(
      expect.anything(),
      "booking_1",
      "host",
      { chargedCents: 0, refundedCents: 4_500 },
    );
  });

  it("persists a fixed error classification instead of a raw Stripe payload", async () => {
    const unsafe = "cardholder@example.com sk_live_private";
    const failingProvider = provider();
    vi.mocked(failingProvider.cancellation).mockRejectedValue(new Error(unsafe));

    const failure = executeMoneyOperation({} as never, operation, failingProvider);
    await expect(failure).rejects.toBeInstanceOf(MoneyOperationExecutionError);
    expect(mocks.failMoneyOperation).toHaveBeenCalledWith(
      expect.anything(),
      operation,
      "Stripe did not confirm the claimed money operation",
      false,
      expect.any(Date),
    );
    expect(JSON.stringify(mocks.failMoneyOperation.mock.calls)).not.toContain(unsafe);
  });
});
