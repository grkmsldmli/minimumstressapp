import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cancel = vi.fn();
const capture = vi.fn();
const retrieve = vi.fn();
const createRefund = vi.fn();
const listRefunds = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { cancel, capture, retrieve };
    refunds = { create: createRefund, list: listRefunds };
  },
}));

vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_pretend");

const { captureHold, releaseHold, settle } = await import("./client");

beforeEach(() => {
  listRefunds.mockResolvedValue({ data: [], has_more: false });
});

afterEach(() => {
  cancel.mockReset();
  capture.mockReset();
  retrieve.mockReset();
  createRefund.mockReset();
  listRefunds.mockReset();
});

describe("idempotent settlement", () => {
  it("uses the durable operation key for a refund", async () => {
    createRefund.mockResolvedValue({ id: "re_1" });

    await settle(
      "pi_1",
      { kind: "refund", amountCents: 4_500 },
      "booking_cancel_bk_1",
    );

    expect(createRefund).toHaveBeenCalledWith(
      {
        payment_intent: "pi_1",
        amount: 4_500,
        metadata: { minimumstress_operation_id: "booking_cancel_bk_1" },
      },
      { idempotencyKey: "booking_cancel_bk_1" },
    );
  });

  it("reconciles a refund by durable operation id after the idempotency window", async () => {
    listRefunds.mockResolvedValue({
      data: [
        {
          id: "re_existing",
          status: "succeeded",
          metadata: { minimumstress_operation_id: "booking_cancel_bk_1" },
        },
      ],
      has_more: false,
    });

    await settle(
      "pi_1",
      { kind: "refund", amountCents: 4_500 },
      "booking_cancel_bk_1",
    );

    expect(createRefund).not.toHaveBeenCalled();
  });

  it("reconciles a committed refund whose response was lost", async () => {
    listRefunds
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockResolvedValueOnce({
        data: [
          {
            id: "re_committed",
            status: "succeeded",
            metadata: { minimumstress_operation_id: "booking_cancel_bk_1" },
          },
        ],
        has_more: false,
      });
    createRefund.mockRejectedValueOnce(new Error("socket closed after commit"));

    await expect(
      settle(
        "pi_1",
        { kind: "refund", amountCents: 4_500 },
        "booking_cancel_bk_1",
      ),
    ).resolves.toBeUndefined();
  });

  it("uses the durable operation key when abandoning an unpaid intent", async () => {
    cancel.mockResolvedValue({ id: "pi_1", status: "canceled" });

    await settle("pi_1", { kind: "abandon" }, "booking_cancel_bk_1");

    expect(cancel).toHaveBeenCalledWith(
      "pi_1",
      undefined,
      { idempotencyKey: "booking_cancel_bk_1" },
    );
  });
});

describe("releaseHold", () => {
  it("uses the durable operation key", async () => {
    cancel.mockResolvedValue({ id: "pi_1", status: "canceled" });

    await releaseHold("pi_1", "booking_request_release_bk_1");

    expect(cancel).toHaveBeenCalledWith(
      "pi_1",
      undefined,
      { idempotencyKey: "booking_request_release_bk_1" },
    );
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("accepts a canceled intent when Stripe committed but lost the response", async () => {
    cancel.mockRejectedValue(new Error("socket closed after write"));
    retrieve.mockResolvedValue({ id: "pi_1", status: "canceled" });

    await expect(
      releaseHold("pi_1", "booking_request_release_bk_1"),
    ).resolves.toBeUndefined();
  });

  it("throws a controlled error when the intent was not canceled", async () => {
    const fakeSecret = ["sk", "live", "private"].join("_");
    cancel.mockRejectedValue(new Error(`secret provider response ${fakeSecret}`));
    retrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture" });

    await expect(releaseHold("pi_1", "booking_request_release_bk_1")).rejects.toThrow(
      "Stripe could not release the payment hold",
    );

    await expect(releaseHold("pi_1", "booking_request_release_bk_1")).rejects.not.toThrow(
      new RegExp(fakeSecret),
    );
  });

  it("does not expose a failed recovery response", async () => {
    cancel.mockRejectedValue(new Error("cancel response contained pi_private"));
    retrieve.mockRejectedValue(new Error("retrieve response contained customer_private"));

    await expect(releaseHold("pi_1", "booking_request_release_bk_1")).rejects.toThrow(
      "Stripe could not release the payment hold",
    );
  });
});

describe("captureHold", () => {
  it("uses a booking-stable operation key", async () => {
    capture.mockResolvedValue({ id: "pi_1", status: "succeeded" });

    await captureHold("pi_1", "booking-1");

    expect(capture).toHaveBeenCalledWith("pi_1", undefined, {
      idempotencyKey: "booking_capture_booking-1",
    });
  });

  it("reconciles a committed capture after its idempotency entry expires", async () => {
    capture.mockRejectedValueOnce(Object.assign(new Error("state changed"), {
      code: "payment_intent_unexpected_state",
    }));
    retrieve.mockResolvedValueOnce({ id: "pi_1", status: "succeeded" });

    await expect(captureHold("pi_1", "booking-1")).resolves.toBeUndefined();
  });
});
