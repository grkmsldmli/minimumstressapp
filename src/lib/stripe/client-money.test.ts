import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const paymentIntentsRetrieve = vi.fn();
const paymentIntentsCancel = vi.fn();
const refundsList = vi.fn();
const refundsCreate = vi.fn();
const refundsRetrieve = vi.fn();
const transfersList = vi.fn();
const transfersCreate = vi.fn();
const reversalsList = vi.fn();
const reversalsCreate = vi.fn();
const reversalsRetrieve = vi.fn();

vi.mock("stripe", () => ({
  default: class {
    paymentIntents = {
      retrieve: paymentIntentsRetrieve,
      cancel: paymentIntentsCancel,
    };
    refunds = {
      list: refundsList,
      create: refundsCreate,
      retrieve: refundsRetrieve,
    };
    transfers = {
      list: transfersList,
      create: transfersCreate,
      listReversals: reversalsList,
      createReversal: reversalsCreate,
      retrieveReversal: reversalsRetrieve,
      retrieve: vi.fn(),
    };
  },
}));

vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_pretend");

const {
  payHost,
  refundRequested,
  releaseHold,
  settleClaimedCancellation,
  StripeReconciliationError,
} = await import("./client");

function iterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

const money = {
  hostRateCents: 4_000,
  serviceFeeCents: 500,
  instantFeeCents: 0,
  proDiscountCents: 0,
  totalCents: 4_500,
  platformCents: 500,
};

beforeEach(() => {
  vi.clearAllMocks();
  refundsList.mockReturnValue(iterable([]));
  transfersList.mockReturnValue(iterable([]));
  reversalsList.mockReturnValue(iterable([]));
});

describe("releaseHold provider recovery", () => {
  it("accepts a post-error retrieve that proves cancellation committed", async () => {
    paymentIntentsRetrieve.mockResolvedValueOnce({ id: "pi_1", status: "canceled" });
    paymentIntentsCancel.mockRejectedValueOnce(new Error("response was lost"));

    await expect(releaseHold("pi_1", "release:1")).resolves.toBeUndefined();
    expect(paymentIntentsCancel).toHaveBeenCalledWith(
      "pi_1",
      undefined,
      { idempotencyKey: "release:1" },
    );
  });

  it("throws only a controlled error when cancellation cannot be proven", async () => {
    const privatePayload = "customer_email_and_request_body";
    paymentIntentsRetrieve.mockResolvedValueOnce({
      id: "pi_1",
      status: "requires_capture",
    });
    paymentIntentsCancel.mockRejectedValueOnce(new Error(privatePayload));

    const error = await releaseHold("pi_1", "release:1").catch((value) => value);
    expect(error).toBeInstanceOf(StripeReconciliationError);
    expect(error.message).toBe("Stripe could not release the payment hold");
    expect(String(error)).not.toContain(privatePayload);
  });
});

describe("durable payout correlation", () => {
  it("finds an existing transfer by operation metadata after key retention", async () => {
    paymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      latest_charge: "ch_1",
    });
    transfersList.mockReturnValue(iterable([
      {
        id: "tr_existing",
        amount: 4_000,
        currency: "usd",
        destination: "acct_host",
        source_transaction: "ch_1",
        transfer_group: "booking_bk_1",
        metadata: {
          minimumstress_money_operation_id: "op_1",
          booking_id: "bk_1",
        },
      },
    ]));

    await expect(payHost(money, "acct_host", "pi_1", {
      bookingId: "bk_1",
      spaceId: "space_1",
      practitionerId: "user_1",
      moneyOperationId: "op_1",
    })).resolves.toEqual({ transferId: "tr_existing" });
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it("fails closed when correlated Stripe transfer facts conflict", async () => {
    paymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      latest_charge: "ch_1",
    });
    transfersList.mockReturnValue(iterable([
      {
        id: "tr_wrong",
        amount: 3_999,
        currency: "usd",
        destination: "acct_host",
        source_transaction: "ch_1",
        transfer_group: "booking_bk_1",
        metadata: { minimumstress_money_operation_id: "op_1" },
      },
    ]));

    const error = await payHost(money, "acct_host", "pi_1", {
      bookingId: "bk_1",
      spaceId: "space_1",
      practitionerId: "user_1",
      moneyOperationId: "op_1",
    }).catch((value) => value);
    expect(error).toMatchObject({ manualReview: true });
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it("finds a legacy transfer after the host destination changed and fails closed", async () => {
    paymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1",
      latest_charge: "ch_1",
    });
    transfersList.mockReturnValue(iterable([
      {
        id: "tr_old_destination",
        amount: 4_000,
        currency: "usd",
        destination: "acct_previous_host",
        source_transaction: "ch_1",
        transfer_group: "booking_bk_1",
        metadata: { booking_id: "bk_1" },
      },
    ]));

    const error = await payHost(money, "acct_current_host", "pi_1", {
      bookingId: "bk_1",
      spaceId: "space_1",
      practitionerId: "user_1",
      moneyOperationId: "op_1",
    }).catch((value) => value);

    expect(transfersList).toHaveBeenCalledWith({
      transfer_group: "booking_bk_1",
      limit: 100,
    });
    expect(error).toMatchObject({ manualReview: true });
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it("fails closed when both legacy and journal payouts exist in the booking group", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" });
    const transfer = {
      amount: 4_000,
      currency: "usd",
      destination: "acct_host",
      source_transaction: "ch_1",
      transfer_group: "booking_bk_1",
    };
    transfersList.mockReturnValue(iterable([
      { ...transfer, id: "tr_legacy", metadata: { booking_id: "bk_1" } },
      {
        ...transfer,
        id: "tr_journal",
        metadata: { minimumstress_money_operation_id: "op_1", booking_id: "bk_1" },
      },
    ]));

    const error = await payHost(money, "acct_host", "pi_1", {
      bookingId: "bk_1",
      spaceId: "space_1",
      practitionerId: "user_1",
      moneyOperationId: "op_1",
    }).catch((value) => value);

    expect(error).toMatchObject({ manualReview: true });
    expect(transfersCreate).not.toHaveBeenCalled();
  });
});

describe("cancellation capture race", () => {
  it("records actual paid truth and refunds after capture wins cancel", async () => {
    paymentIntentsRetrieve
      .mockResolvedValueOnce({ id: "pi_1", status: "requires_capture", amount_received: 0 })
      .mockResolvedValueOnce({ id: "pi_1", status: "succeeded", amount_received: 4_500 });
    paymentIntentsCancel.mockRejectedValueOnce(new Error("capture won"));
    refundsCreate.mockResolvedValue({
      id: "re_1",
      amount: 4_500,
      currency: "usd",
      payment_intent: "pi_1",
      status: "succeeded",
      metadata: {},
    });

    await expect(settleClaimedCancellation("pi_1", 4_500, {
      operationId: "op_cancel",
      bookingId: "bk_1",
      operationKind: "cancellation",
    })).resolves.toEqual({
      refundId: "re_1",
      providerStatus: "succeeded",
      paymentIntentStatus: "succeeded",
      paidCents: 4_500,
      refundedCents: 4_500,
    });
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_1",
        amount: 4_500,
        metadata: expect.objectContaining({
          minimumstress_money_operation_id: "op_cancel",
        }),
      }),
      { idempotencyKey: "ms_money:op_cancel:customer_refund:v1" },
    );
  });
});

describe("correlated refund and transfer reversal", () => {
  it("reuses both provider objects instead of mutating Stripe again", async () => {
    reversalsList.mockReturnValue(iterable([
      {
        id: "trr_existing",
        amount: 4_000,
        currency: "usd",
        transfer: "tr_host",
        metadata: { minimumstress_money_operation_id: "op_refund" },
      },
    ]));
    refundsList.mockReturnValue(iterable([
      {
        id: "re_existing",
        amount: 4_500,
        currency: "usd",
        payment_intent: "pi_1",
        status: "succeeded",
        metadata: {
          minimumstress_money_operation_id: "op_refund",
          operation_step: "customer_refund",
        },
      },
    ]));

    await expect(refundRequested(
      "pi_1",
      4_500,
      "tr_host",
      4_000,
      "rr_1",
      {
        operationId: "op_refund",
        bookingId: "bk_1",
      },
    )).resolves.toMatchObject({
      refundId: "re_existing",
      reversalId: "trr_existing",
      refundedCents: 4_500,
      reversedCents: 4_000,
    });
    expect(reversalsCreate).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});
