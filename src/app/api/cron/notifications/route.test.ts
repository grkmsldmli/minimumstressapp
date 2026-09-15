import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const money = vi.hoisted(() => ({
  claimRetries: vi.fn(),
  execute: vi.fn(),
}));
const financial = vi.hoisted(() => ({ retry: vi.fn() }));
const stages = vi.hoisted(() => ({
  confirmation: vi.fn(async () => ({ reconciled: 8 })),
  cancellation: vi.fn(async () => ({ reconciled: 1 })),
  submission: vi.fn(async () => ({ reconciled: 2 })),
  outcome: vi.fn(async () => ({ reconciled: 3 })),
  refundRequest: vi.fn(async () => ({ reconciled: 9 })),
  refundDecision: vi.fn(async () => ({ reconciled: 7 })),
  payout: vi.fn(async () => ({ reconciled: 4 })),
  access: vi.fn(async () => ({ announced: 5 })),
  notifications: vi.fn(async () => ({ retried: 6, sent: 6, givenUp: 0 })),
}));

vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/lib/money-operations", () => ({
  claimMoneyOperationRetries: money.claimRetries,
}));
vi.mock("@/lib/money-operation-service", () => ({
  executeMoneyOperation: money.execute,
}));
vi.mock("@/lib/financial-resolution", () => ({
  retryFinancialResolutions: financial.retry,
}));
vi.mock("@/lib/api/stripe-gateway", () => ({ stripeGateway: {} }));
vi.mock("@/lib/notify/for-booking", () => ({
  reconcileBookingConfirmationNotifications: stages.confirmation,
  reconcileCancellationNotifications: stages.cancellation,
  reconcileRequestSubmissionNotifications: stages.submission,
  reconcileRequestOutcomeNotifications: stages.outcome,
  reconcileHostPayoutNotifications: stages.payout,
  notifyAccessCodesReady: stages.access,
}));
vi.mock("@/lib/notify/for-refund", () => ({
  reconcileRefundRequestNotifications: stages.refundRequest,
  reconcileRefundDecisionNotifications: stages.refundDecision,
}));
vi.mock("@/lib/notify/send", () => ({ retryPending: stages.notifications }));

const { GET } = await import("./route");

function request(): Request {
  return new Request("https://example.test/api/cron/notifications", {
    headers: { authorization: "Bearer cron-test-secret" },
  });
}

async function run(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(request() as never);
  return { status: response.status, body: await response.json() };
}

describe("money-operation recovery in the frequent cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    financial.retry.mockResolvedValue({
      claimed: 0,
      resolved: 0,
      retrying: 0,
      manualReview: 0,
    });
    money.claimRetries.mockResolvedValue([
      { id: "op_1", kind: "cancellation" },
      { id: "op_2", kind: "payout" },
    ]);
    money.execute
      .mockRejectedValueOnce(new Error("one provider record is unavailable"))
      .mockResolvedValueOnce({ committed: true, refundedCents: 0 });
  });

  it("retries every claimed row independently and reports the result", async () => {
    const result = await run();

    expect(result.status).toBe(200);
    expect(money.claimRetries).toHaveBeenCalledWith(
      expect.anything(),
      25,
      undefined,
      expect.any(Date),
    );
    expect(money.execute).toHaveBeenCalledTimes(2);
    expect(result.body).toMatchObject({
      moneyOperationsRetryClaimed: 2,
      moneyOperationsRetried: 1,
      moneyOperationsRetryFailed: 1,
      bookingConfirmationsReconciled: 8,
      cancellationsReconciled: 1,
      refundRequestsReconciled: 9,
      refundDecisionsReconciled: 7,
      accessCodesAnnounced: 5,
    });
  });

  it("keeps all notification stages running when claiming retries fails", async () => {
    money.claimRetries.mockRejectedValue(new Error("database unavailable"));

    const result = await run();

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      error: "Notification worker incomplete",
      failedStages: ["moneyOperations"],
      bookingConfirmationsReconciled: 8,
      cancellationsReconciled: 1,
      requestSubmissionsReconciled: 2,
      requestOutcomesReconciled: 3,
      refundRequestsReconciled: 9,
      refundDecisionsReconciled: 7,
      payoutReceiptsReconciled: 4,
      accessCodesAnnounced: 5,
    });
    expect(stages.notifications).toHaveBeenCalledOnce();
  });
});
