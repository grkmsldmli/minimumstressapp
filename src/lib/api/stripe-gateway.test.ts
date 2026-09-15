import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { settle, paymentIntentSettlementState } = vi.hoisted(() => ({
  settle: vi.fn(),
  paymentIntentSettlementState: vi.fn(),
}));

vi.mock("../stripe/client", () => ({
  captureHold: vi.fn(),
  chargeBooking: vi.fn(),
  payHost: vi.fn(),
  releaseHold: vi.fn(),
  settle,
  paymentIntentSettlementState,
}));

import { stripeGateway } from "./stripe-gateway";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cancellation settlement reconciliation", () => {
  it("turns a stale uncaptured cancellation into the refund provider truth requires", async () => {
    const crossed = Object.assign(new Error("intent state changed"), {
      code: "payment_intent_unexpected_state",
    });
    settle.mockRejectedValueOnce(crossed).mockResolvedValueOnce(undefined);
    paymentIntentSettlementState.mockResolvedValue({
      status: "succeeded",
      amountReceivedCents: 6_000,
    });

    await expect(
      stripeGateway.settle(
        "pi_1",
        0,
        { action: "void", chargedCents: 0 },
        "booking_financial_cancellation_bk_1",
      ),
    ).resolves.toEqual({ refundedCents: 6_000, paidCents: 6_000 });

    expect(settle).toHaveBeenNthCalledWith(
      2,
      "pi_1",
      { kind: "refund", amountCents: 6_000 },
      "booking_financial_cancellation_bk_1:refund",
    );
    expect(settle).toHaveBeenNthCalledWith(
      1,
      "pi_1",
      { kind: "abandon" },
      "booking_financial_cancellation_bk_1:abandon",
    );
  });

  it("accepts a cancellation that Stripe committed before losing its response", async () => {
    settle.mockRejectedValueOnce(new Error("socket closed"));
    paymentIntentSettlementState.mockResolvedValue({
      status: "canceled",
      amountReceivedCents: 0,
    });

    await expect(
      stripeGateway.settle(
        "pi_1",
        0,
        { action: "void", chargedCents: 0 },
        "booking_financial_cancellation_bk_1",
      ),
    ).resolves.toEqual({ refundedCents: 0, paidCents: 0 });
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("keeps the original retryable failure when provider truth is unavailable", async () => {
    const failure = new Error("socket closed");
    settle.mockRejectedValueOnce(failure);
    paymentIntentSettlementState.mockRejectedValueOnce(new Error("retrieve unavailable"));

    await expect(
      stripeGateway.settle(
        "pi_1",
        0,
        { action: "void", chargedCents: 0 },
        "booking_financial_cancellation_bk_1",
      ),
    ).rejects.toBe(failure);
  });
});
