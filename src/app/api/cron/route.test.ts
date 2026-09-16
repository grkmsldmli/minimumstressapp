import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  bookingResults: [] as Array<{ data: unknown; error: unknown }>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  events: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const result = table === "bookings"
        ? (state.bookingResults.shift() ?? { data: [], error: null })
        : { data: null, error: null, count: 0 };
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select", "lte", "not", "eq", "is", "in", "or", "lt", "delete", "update",
      ]) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push({ table, method, args });
          if (table === "bookings" && method === "lte" && args[0] === "ends_at") {
            state.events.push("payout-query");
          }
          return chain;
        };
      }
      chain.then = (
        resolve: (value: typeof result) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  }),
}));

const financial = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock("@/lib/financial-resolution", () => ({
  retryFinancialResolutions: financial.retry,
}));

const money = vi.hoisted(() => ({
  claimRetries: vi.fn(),
  claimPayout: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@/lib/money-operations", () => ({
  claimMoneyOperationRetries: money.claimRetries,
  claimPayout: money.claimPayout,
}));
vi.mock("@/lib/money-operation-service", () => ({
  executeMoneyOperation: money.execute,
}));

vi.mock("@/lib/approval-service", () => ({
  expireStaleRequests: vi.fn(async () => ({ expired: 0 })),
  remindWaitingHosts: vi.fn(async () => ({ reminded: 0 })),
}));
vi.mock("@/lib/api/stripe-gateway", () => ({ stripeGateway: {} }));
vi.mock("@/lib/admin/access", () => ({ safetyRecipient: () => null }));
vi.mock("@/lib/admin/attention", () => ({
  subjectFor: vi.fn(),
  waitingOn: vi.fn(() => []),
  waitingSignature: vi.fn(),
}));
vi.mock("@/lib/notify/for-booking", () => ({
  notifyAccessCodesReady: vi.fn(async () => ({ announced: 0 })),
  reconcileBookingConfirmationNotifications: vi.fn(async () => ({ reconciled: 8 })),
  reconcileCancellationNotifications: vi.fn(async () => ({ reconciled: 0 })),
  reconcileHostPayoutNotifications: vi.fn(async () => ({ reconciled: 0 })),
  reconcileRequestOutcomeNotifications: vi.fn(async () => ({ reconciled: 0 })),
  reconcileRequestSubmissionNotifications: vi.fn(async () => ({ reconciled: 0 })),
}));
vi.mock("@/lib/notify/for-refund", () => ({
  reconcileRefundRequestNotifications: vi.fn(async () => ({ reconciled: 9 })),
  reconcileRefundDecisionNotifications: vi.fn(async () => ({ reconciled: 7 })),
}));
vi.mock("@/lib/notify/send", () => ({
  notify: vi.fn(),
  retryPending: vi.fn(async () => ({ sent: 0 })),
}));
vi.mock("@/lib/notify/message-jobs", () => ({
  processMessageNotificationJobs: vi.fn(async () => ({
    claimed: 3,
    completed: 3,
    retrying: 0,
    failed: 0,
  })),
}));
vi.mock("@/lib/notify/for-review", () => ({
  notifyReviewRequests: vi.fn(async () => ({ prompted: 2, reminded: 1 })),
  reconcileReviewLifecycleNotifications: vi.fn(async () => ({
    submitted: 4,
    counterpart: 1,
    published: 2,
  })),
}));
vi.mock("@/lib/stripe/client", () => ({ settle: vi.fn() }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://minimumstress.app" }));

const { GET, payHostsForFinishedSessions, runOperationalTasks } = await import("./route");

const retryOperation = { id: "op_retry", kind: "refund_request" };
const payoutOperation = { id: "op_payout", kind: "payout" };

function cronRequest(): Request {
  return new Request("https://example.test/api/cron", {
    headers: { authorization: "Bearer cron-test-secret" },
  });
}

async function run(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(cronRequest() as never);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  state.calls = [];
  state.events = [];
  // Payout candidate scan, then abandoned-checkout scan.
  state.bookingResults = [
    { data: [{ id: "bk_due" }], error: null },
    { data: [], error: null },
  ];
  financial.retry.mockImplementation(async () => {
    state.events.push("financial-resolution");
    return { claimed: 0, resolved: 0, retrying: 0, manualReview: 0 };
  });
  money.claimRetries.mockImplementation(async () => {
    state.events.push("money-retry-claim");
    return [retryOperation];
  });
  money.claimPayout.mockResolvedValue(payoutOperation);
  money.execute.mockResolvedValue({ committed: true, refundedCents: 0 });
});

describe("money operations in the operational cron", () => {
  it("settles legacy work and journal retries before looking for payouts", async () => {
    await runOperationalTasks(new Date("2026-09-15T12:00:00.000Z"));
    expect(state.events.slice(0, 3)).toEqual([
      "financial-resolution",
      "money-retry-claim",
      "payout-query",
    ]);
  });

  it("retries claimed operations before paying sessions that have ended", async () => {
    const result = await run();

    expect(result.status).toBe(200);
    expect(money.execute).toHaveBeenNthCalledWith(
      1, expect.anything(), retryOperation, undefined, expect.any(Date),
    );
    expect(money.claimPayout).toHaveBeenCalledWith(
      expect.anything(), "bk_due", undefined, expect.any(Date),
    );
    expect(money.execute).toHaveBeenNthCalledWith(
      2, expect.anything(), payoutOperation, undefined, expect.any(Date),
    );
    expect(state.calls).toContainEqual({
      table: "bookings",
      method: "lte",
      args: ["ends_at", expect.any(String)],
    });
    expect(state.calls).toContainEqual({
      table: "bookings",
      method: "in",
      args: ["financial_resolution_state", ["not_required", "resolved"]],
    });
    expect(result.body).toMatchObject({
      moneyOperationsRetryClaimed: 1,
      moneyOperationsRetried: 1,
      moneyOperationsRetryFailed: 0,
      paid: 1,
      failed: 0,
      payoutClaimsSkipped: 0,
      bookingConfirmationsReconciled: 8,
      refundRequestsReconciled: 9,
      refundDecisionsReconciled: 7,
    });
  });

  it("isolates a retry failure so an unrelated payout can still commit", async () => {
    money.execute
      .mockRejectedValueOnce(new Error("retry unavailable"))
      .mockResolvedValueOnce({ committed: true, refundedCents: 0 });

    const result = await run();
    expect(result.body).toMatchObject({
      moneyOperationsRetryClaimed: 1,
      moneyOperationsRetried: 0,
      moneyOperationsRetryFailed: 1,
      paid: 1,
      failed: 0,
    });
  });

  it("does not execute Stripe work when a concurrent transition wins the payout claim", async () => {
    money.claimRetries.mockResolvedValue([]);
    money.claimPayout.mockResolvedValue(null);

    const result = await run();
    expect(money.execute).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ paid: 0, failed: 0, payoutClaimsSkipped: 1 });
    expect(state.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("returns an empty payout result when there are no due bookings", async () => {
    state.bookingResults = [{ data: [], error: null }];
    await expect(
      payHostsForFinishedSessions(new Date("2026-09-15T12:00:00.000Z")),
    ).resolves.toEqual({ paid: 0, failed: 0, payoutClaimsSkipped: 0 });
  });
});
