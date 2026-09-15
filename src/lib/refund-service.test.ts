import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const serviceMocks = vi.hoisted(() => ({
  claimRefundDecision: vi.fn(),
  executeMoneyOperation: vi.fn(),
  notifyRefundRequested: vi.fn(),
}));

vi.mock("./money-operations", () => ({
  claimRefundDecision: serviceMocks.claimRefundDecision,
}));

vi.mock("./money-operation-service", () => {
  class FakeMoneyOperationExecutionError extends Error {
    constructor(readonly manualReview: boolean) {
      super(manualReview ? "Needs manual review" : "Queued for retry");
    }
  }

  return {
    executeMoneyOperation: serviceMocks.executeMoneyOperation,
    MoneyOperationExecutionError: FakeMoneyOperationExecutionError,
  };
});

vi.mock("./notify/for-refund", () => ({
  notifyRefundRequested: serviceMocks.notifyRefundRequested,
}));

import { MoneyOperationExecutionError } from "./money-operation-service";
import { decideRefund, requestRefund } from "./refund-service";
import type { FinancialResolutionState } from "./financial-resolution";

const NOW = new Date("2026-09-15T12:00:00.000Z");

const booking = {
  id: "00000000-0000-4000-8000-000000000001",
  practitioner_id: "00000000-0000-4000-8000-000000000002",
  space_id: "00000000-0000-4000-8000-000000000003",
  status: "completed",
  starts_at: "2026-09-17T12:00:00.000Z",
  total_cents: 5_000,
  host_rate_cents: 4_000,
  stripe_payment_intent_id: "pi_paid",
  captured_at: "2026-09-15T11:00:00.000Z",
  stripe_transfer_id: null,
  host_paid_at: null,
  refunded_cents: 0,
  financial_resolution_state: "not_required" as FinancialResolutionState,
};

const request = {
  id: "00000000-0000-4000-8000-000000000004",
  booking_id: booking.id,
  state: "awaiting_staff",
};

const operation = {
  id: "00000000-0000-4000-8000-000000000005",
  booking_id: booking.id,
  refund_request_id: request.id,
  kind: "refund_request",
  state: "claimed",
  lease_token: "00000000-0000-4000-8000-000000000006",
};

interface FakeAdminOptions {
  booking?: typeof booking;
  request?: typeof request;
  recentRequests?: number;
  insertError?: { code: string } | null;
}

function resolvedChain(result: Record<string, unknown>) {
  const chain = {
    eq: () => chain,
    gte: () => chain,
    in: () => chain,
    select: () => chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (
      resolve: (value: Record<string, unknown>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function fakeAdmin(options: FakeAdminOptions = {}) {
  const inserted: Record<string, unknown>[] = [];
  const events: string[] = [];

  const admin = {
    from(table: string) {
      if (table === "bookings") {
        return {
          select: () =>
            resolvedChain({ data: options.booking ?? booking, error: null }),
        };
      }

      if (table !== "refund_requests") throw new Error(`Unexpected table ${table}`);
      return {
        select(_columns: string, settings?: { head?: boolean }) {
          return settings?.head
            ? resolvedChain({
                data: null,
                error: null,
                count: options.recentRequests ?? 0,
              })
            : resolvedChain({ data: options.request ?? request, error: null });
        },
        insert(payload: Record<string, unknown>) {
          inserted.push(payload);
          events.push("insert-undecided");
          return resolvedChain({
            data: options.insertError ? null : { id: request.id },
            error: options.insertError ?? null,
          });
        },
      };
    },
  };

  return { admin: admin as never, events, inserted };
}

describe("refund decision journal integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.claimRefundDecision.mockResolvedValue(operation);
    serviceMocks.executeMoneyOperation.mockResolvedValue({
      committed: true,
      refundedCents: 5_000,
    });
    serviceMocks.notifyRefundRequested.mockResolvedValue(undefined);
  });

  it("persists an automatic monetary decision as undecided before claiming it", async () => {
    const { admin, events, inserted } = fakeAdmin();
    serviceMocks.notifyRefundRequested.mockImplementation(async () => {
      events.push("request-notification");
    });
    serviceMocks.claimRefundDecision.mockImplementation(async () => {
      events.push("claim");
      return operation;
    });
    serviceMocks.executeMoneyOperation.mockImplementation(async () => {
      events.push("execute");
      return { committed: true, refundedCents: 5_000 };
    });

    const result = await requestRefund(
      admin,
      booking.id,
      booking.practitioner_id,
      {
        reason: "changed_plans",
        detail: "My plans changed with enough advance notice.",
        evidencePath: null,
      },
      NOW,
    );

    expect(inserted).toEqual([
      expect.objectContaining({
        booking_id: booking.id,
        practitioner_id: booking.practitioner_id,
        state: "awaiting_staff",
      }),
    ]);
    expect(inserted[0]).not.toHaveProperty("outcome");
    expect(inserted[0]).not.toHaveProperty("decided_at");
    expect(events).toEqual([
      "insert-undecided",
      "request-notification",
      "claim",
      "execute",
    ]);
    expect(serviceMocks.claimRefundDecision).toHaveBeenCalledWith(
      admin,
      {
        requestId: request.id,
        decisionActorId: booking.practitioner_id,
        outcome: "full",
        note: expect.stringContaining("24 hours"),
      },
      undefined,
      NOW,
    );
    expect(result).toMatchObject({ state: "approved", outcome: "full" });
  });

  it("routes an automatic refusal through the committed no-provider operation", async () => {
    const { admin } = fakeAdmin({
      booking: {
        ...booking,
        starts_at: "2026-09-15T18:00:00.000Z",
      },
    });
    const refusedOperation = { ...operation, state: "committed" };
    serviceMocks.claimRefundDecision.mockResolvedValue(refusedOperation);
    serviceMocks.executeMoneyOperation.mockResolvedValue({
      committed: true,
      refundedCents: 0,
    });

    const result = await requestRefund(
      admin,
      booking.id,
      booking.practitioner_id,
      {
        reason: "changed_plans",
        detail: "My plans changed inside the cancellation window.",
        evidencePath: null,
      },
      NOW,
    );

    expect(serviceMocks.claimRefundDecision).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ outcome: "none" }),
      undefined,
      NOW,
    );
    expect(serviceMocks.executeMoneyOperation).toHaveBeenCalledWith(
      admin,
      refusedOperation,
      undefined,
      NOW,
    );
    expect(result).toMatchObject({ state: "refused", outcome: "none" });
  });

  it("returns 409 and never executes when another decision owns the claim", async () => {
    const { admin } = fakeAdmin();
    serviceMocks.claimRefundDecision.mockResolvedValue(null);

    const decision = decideRefund(
      admin,
      request.id,
      "00000000-0000-4000-8000-000000000007",
      "our_fee",
      "The platform fee should be returned after staff review.",
      NOW,
    );

    await expect(decision).rejects.toMatchObject({ status: 409 });
    expect(serviceMocks.executeMoneyOperation).not.toHaveBeenCalled();
  });

  it("does not turn a provider-pending result into an approved response", async () => {
    const { admin } = fakeAdmin();
    serviceMocks.executeMoneyOperation.mockResolvedValue({
      committed: false,
      refundedCents: 0,
    });

    const decision = decideRefund(
      admin,
      request.id,
      "00000000-0000-4000-8000-000000000007",
      "full",
      "The evidence supports returning the complete booking charge.",
      NOW,
    );

    await expect(decision).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    { manualReview: false, status: 503 },
    { manualReview: true, status: 409 },
  ])(
    "preserves a controlled provider failure (manual=$manualReview)",
    async ({ manualReview, status }) => {
      const { admin } = fakeAdmin();
      serviceMocks.executeMoneyOperation.mockRejectedValue(
        new MoneyOperationExecutionError(manualReview),
      );

      const decision = decideRefund(
        admin,
        request.id,
        "00000000-0000-4000-8000-000000000007",
        "full",
        "The evidence supports returning the complete booking charge.",
        NOW,
      );

      await expect(decision).rejects.toMatchObject({ status });
    },
  );
});

describe.each(["pending", "manual_review"] as const)(
  "a booking whose legacy financial resolution is %s",
  (financialState) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("cannot open a separate refund request", async () => {
      const { admin } = fakeAdmin({
        booking: { ...booking, financial_resolution_state: financialState },
      });

      await expect(
        requestRefund(
          admin,
          booking.id,
          booking.practitioner_id,
          {
            reason: "no_access",
            detail: "The session could not happen.",
            evidencePath: null,
          },
          NOW,
        ),
      ).rejects.toMatchObject({ status: 409 });

      expect(serviceMocks.claimRefundDecision).not.toHaveBeenCalled();
      expect(serviceMocks.executeMoneyOperation).not.toHaveBeenCalled();
    });

    it("cannot be decided by staff", async () => {
      const { admin } = fakeAdmin({
        booking: { ...booking, financial_resolution_state: financialState },
      });

      await expect(
        decideRefund(
          admin,
          request.id,
          "00000000-0000-4000-8000-000000000007",
          "full",
          "Approved after staff review.",
          NOW,
        ),
      ).rejects.toMatchObject({ status: 409 });

      expect(serviceMocks.claimRefundDecision).not.toHaveBeenCalled();
      expect(serviceMocks.executeMoneyOperation).not.toHaveBeenCalled();
    });
  },
);
