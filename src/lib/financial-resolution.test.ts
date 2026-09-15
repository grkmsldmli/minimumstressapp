import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FinancialResolutionError,
  cancellationFinancialIdempotencyKey,
  financialResolutionPatch,
  initialFinancialResolution,
  requestHoldFinancialIdempotencyKey,
  resolveApprovalCaptureFinancial,
  resolveCancellationFinancial,
  resolveRequestHoldFinancial,
  retryFinancialResolutions,
  type FinancialResolutionRow,
  type FinancialStripeGateway,
} from "./financial-resolution";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function booking(
  over: Partial<FinancialResolutionRow> = {}
): FinancialResolutionRow {
  return {
    id: "booking-1",
    stripe_payment_intent_id: "pi_1",
    approval_state: "not_required",
    cancelled_by: "host",
    cancelled_at: NOW.toISOString(),
    starts_at: "2026-09-20T12:00:00.000Z",
    captured_at: "2026-09-10T12:00:00.000Z",
    was_pro: false,
    host_rate_cents: 5_000,
    service_fee_cents: 1_000,
    instant_fee_cents: 0,
    pro_discount_cents: 0,
    total_cents: 6_000,
    platform_cents: 1_000,
    attempts: 1,
    lease_token: "lease-1",
    ...over,
  };
}

function fakeStripe(): FinancialStripeGateway {
  return {
    capture: vi.fn(async () => {}),
    settle: vi.fn(async () => ({ refundedCents: 6_000 })),
    release: vi.fn(async () => {}),
  };
}

function fakeAdmin(claimed: FinancialResolutionRow[] = []) {
  const updates: Array<{
    patch: Record<string, unknown>;
    guards: Array<[string, unknown]>;
  }> = [];
  const rpc = vi.fn(async () => ({ data: claimed, error: null }));

  return {
    updates,
    rpc,
    client: {
      rpc,
      from: vi.fn(() => ({
        update: (patch: Record<string, unknown>) => {
          const guards: Array<[string, unknown]> = [];
          const chain = {
            eq(column: string, value: unknown) {
              guards.push([column, value]);
              return chain;
            },
            select() {
              return chain;
            },
            maybeSingle: async () => {
              updates.push({ patch, guards });
              return {
                data: { id: String(guards.find(([key]) => key === "id")?.[1]) },
                error: null,
              };
            },
          };
          return chain;
        },
      })),
    } as never,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("starting a durable financial resolution", () => {
  it("leases recoverable Stripe work before the provider call", () => {
    const result = initialFinancialResolution(true, NOW);

    expect(result.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.patch).toEqual({
      financial_resolution_state: "pending",
      financial_resolution_attempts: 1,
      financial_resolution_next_attempt_at: NOW.toISOString(),
      financial_resolution_last_error: null,
      financial_resolved_at: null,
      financial_resolution_lease_token: result.leaseToken,
      financial_resolution_lease_until: "2026-09-15T12:15:00.000Z",
    });
  });

  it("accepts an existing lease token for an enclosing write", () => {
    expect(
      financialResolutionPatch(true, NOW, "transaction-lease")
    ).toMatchObject({
      leaseToken: "transaction-lease",
      patch: { financial_resolution_lease_token: "transaction-lease" },
    });
  });

  it("resolves a terminal booking that has no provider work", () => {
    expect(initialFinancialResolution(false, NOW)).toEqual({
      leaseToken: null,
      patch: {
        financial_resolution_state: "resolved",
        financial_resolution_attempts: 0,
        financial_resolution_next_attempt_at: null,
        financial_resolution_last_error: null,
        financial_resolved_at: NOW.toISOString(),
        financial_resolution_lease_token: null,
        financial_resolution_lease_until: null,
      },
    });
  });
});

describe("cancellation settlement", () => {
  it("uses a stable key, frozen cancellation time and lease-fenced finalization", async () => {
    const admin = fakeAdmin();
    const stripe = fakeStripe();
    const row = booking();

    await expect(
      resolveCancellationFinancial(admin.client, stripe, row, "lease-1", NOW)
    ).resolves.toEqual({ refundedCents: 6_000, chargedCents: 0 });

    expect(stripe.settle).toHaveBeenCalledWith(
      "pi_1",
      6_000,
      expect.objectContaining({ action: "void", chargedCents: 0 }),
      cancellationFinancialIdempotencyKey("booking-1")
    );
    expect(admin.updates[0]).toMatchObject({
      guards: [
        ["id", "booking-1"],
        ["financial_resolution_lease_token", "lease-1"],
      ],
      patch: {
        status: "cancelled_by_host",
        financial_resolution_state: "resolved",
        financial_resolved_at: NOW.toISOString(),
        refunded_cents: 6_000,
        refunded_at: NOW.toISOString(),
        financial_resolution_lease_token: null,
      },
    });
  });

  it("records a capture that Stripe proves during cancellation recovery", async () => {
    const admin = fakeAdmin();
    const stripe = fakeStripe();
    vi.mocked(stripe.settle).mockResolvedValueOnce({
      refundedCents: 5_799,
      paidCents: 6_000,
    });
    const row = booking({ captured_at: null });

    await expect(
      resolveCancellationFinancial(admin.client, stripe, row, "lease-1", NOW),
    ).resolves.toEqual({ refundedCents: 5_799, chargedCents: 201 });

    expect(admin.updates[0].patch).toMatchObject({
      captured_at: NOW.toISOString(),
      refunded_cents: 5_799,
      financial_resolution_state: "resolved",
    });
  });

  it("stores a controlled retry code instead of Stripe's raw error", async () => {
    const admin = fakeAdmin();
    const stripe = fakeStripe();
    vi.mocked(stripe.settle).mockRejectedValueOnce(
      new Error("secret cardholder data and provider response")
    );

    await expect(
      resolveCancellationFinancial(
        admin.client,
        stripe,
        booking(),
        "lease-1",
        NOW
      )
    ).rejects.toMatchObject({
      disposition: "retry",
    } satisfies Partial<FinancialResolutionError>);

    expect(admin.updates[0].patch).toMatchObject({
      financial_resolution_state: "pending",
      financial_resolution_last_error: "stripe_financial_resolution_failed",
      financial_resolution_next_attempt_at: "2026-09-15T12:01:00.000Z",
      financial_resolution_lease_token: null,
    });
    expect(JSON.stringify(admin.updates[0].patch)).not.toContain("cardholder");
  });

  it("sends permanent provider inconsistencies directly to manual review", async () => {
    const admin = fakeAdmin();
    const stripe = fakeStripe();
    vi.mocked(stripe.settle).mockRejectedValueOnce({
      code: "resource_missing",
      message: "No such pi_secret_value",
    });

    await expect(
      resolveCancellationFinancial(
        admin.client,
        stripe,
        booking(),
        "lease-1",
        NOW
      )
    ).rejects.toMatchObject({
      disposition: "manual_review",
    } satisfies Partial<FinancialResolutionError>);

    expect(admin.updates[0].patch).toMatchObject({
      financial_resolution_state: "manual_review",
      financial_resolution_next_attempt_at: null,
      financial_resolution_last_error: "stripe_payment_intent_missing",
    });
    expect(JSON.stringify(admin.updates[0].patch)).not.toContain(
      "pi_secret_value"
    );
  });
});

describe("request hold release", () => {
  it("releases with a stable key and records no refund", async () => {
    const admin = fakeAdmin();
    const stripe = fakeStripe();
    const row = booking({
      approval_state: "declined",
      cancelled_by: null,
      captured_at: null,
    });

    await expect(
      resolveRequestHoldFinancial(admin.client, stripe, row, "lease-1", NOW)
    ).resolves.toEqual({ refundedCents: 0 });

    expect(stripe.release).toHaveBeenCalledWith(
      "pi_1",
      requestHoldFinancialIdempotencyKey("booking-1")
    );
    expect(admin.updates[0].patch).toMatchObject({
      status: "cancelled_by_host",
      financial_resolution_state: "resolved",
      financial_resolved_at: NOW.toISOString(),
    });
    expect(admin.updates[0].patch).not.toHaveProperty("refunded_cents");
  });
});

describe("approved request capture", () => {
  it("captures under the booking key and finalizes the durable journal", async () => {
    const admin = fakeAdmin();
    const stripe = fakeStripe();
    const row = booking({
      approval_state: "approved",
      cancelled_by: null,
      cancelled_at: null,
      captured_at: null,
    });

    await expect(
      resolveApprovalCaptureFinancial(admin.client, stripe, row, "lease-1", NOW),
    ).resolves.toEqual({ refundedCents: 0 });

    expect(stripe.capture).toHaveBeenCalledWith("pi_1", "booking-1");
    expect(admin.updates[0].patch).toMatchObject({
      status: "upcoming",
      captured_at: NOW.toISOString(),
      financial_resolution_state: "resolved",
      financial_resolved_at: NOW.toISOString(),
    });
  });

  it("trusts an already-recorded signed capture without mutating Stripe again", async () => {
    const admin = fakeAdmin();
    const stripe = fakeStripe();
    const row = booking({
      approval_state: "approved",
      cancelled_by: null,
      cancelled_at: null,
      captured_at: NOW.toISOString(),
    });

    await resolveApprovalCaptureFinancial(admin.client, stripe, row, "lease-1", NOW);

    expect(stripe.capture).not.toHaveBeenCalled();
    expect(admin.updates[0].patch).toMatchObject({
      captured_at: NOW.toISOString(),
      financial_resolution_state: "resolved",
    });
  });
});

describe("the retry worker", () => {
  it("claims once, routes both resolution types, and never exceeds five provider calls", async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      index % 2 === 0
        ? booking({ id: `cancel-${index}`, lease_token: "worker-lease" })
        : booking({
            id: `request-${index}`,
            approval_state: "expired",
            cancelled_by: null,
            captured_at: null,
            lease_token: "worker-lease",
          })
    );
    const admin = fakeAdmin(rows);
    let active = 0;
    let peak = 0;
    const stripe: FinancialStripeGateway = {
      capture: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
      }),
      settle: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return { refundedCents: 6_000 };
      }),
      release: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
      }),
    };

    await expect(
      retryFinancialResolutions(admin.client, stripe, 1_000, NOW)
    ).resolves.toEqual({
      claimed: 8,
      resolved: 8,
      retrying: 0,
      manualReview: 0,
    });

    expect(admin.rpc).toHaveBeenCalledWith(
      "claim_booking_financial_resolution_batch",
      {
        p_worker: expect.any(String),
        p_limit: 100,
        p_now: NOW.toISOString(),
      }
    );
    expect(stripe.settle).toHaveBeenCalledTimes(4);
    expect(stripe.release).toHaveBeenCalledTimes(4);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("terminalizes a claimed row whose business state cannot name an action", async () => {
    const invalid = booking({
      approval_state: "not_required",
      cancelled_by: null,
      cancelled_at: null,
    });
    const admin = fakeAdmin([invalid]);
    const stripe = fakeStripe();

    await expect(
      retryFinancialResolutions(admin.client, stripe, 20, NOW)
    ).resolves.toEqual({
      claimed: 1,
      resolved: 0,
      retrying: 0,
      manualReview: 1,
    });
    expect(admin.updates[0].patch).toMatchObject({
      financial_resolution_state: "manual_review",
      financial_resolution_last_error: "invalid_financial_resolution_state",
    });
    expect(stripe.settle).not.toHaveBeenCalled();
    expect(stripe.release).not.toHaveBeenCalled();
  });
});
