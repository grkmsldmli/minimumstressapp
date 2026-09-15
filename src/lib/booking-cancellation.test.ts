import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { notifyCancellation, recordEvent } = vi.hoisted(() => ({
  notifyCancellation: vi.fn(async () => {}),
  recordEvent: vi.fn(async () => {}),
}));

vi.mock("./notify/for-booking", () => ({ notifyCancellation }));
vi.mock("./analytics/record", () => ({ recordEvent }));

import { BookingError, cancelBooking, type StripeGateway } from "./booking-service";

const NOW = new Date("2026-09-15T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

function initialRow(): Record<string, unknown> {
  return {
    id: "booking-1",
    practitioner_id: "practitioner-1",
    status: "upcoming",
    cancelled_at: null,
    cancelled_by: null,
    approval_state: "not_required",
    starts_at: "2026-09-20T12:00:00.000Z",
    captured_at: "2026-09-14T12:00:00.000Z",
    stripe_payment_intent_id: "pi_1",
    was_pro: false,
    host_rate_cents: 5_000,
    service_fee_cents: 1_000,
    instant_fee_cents: 0,
    pro_discount_cents: 0,
    total_cents: 6_000,
    platform_cents: 1_000,
    refunded_cents: 0,
    active_money_operation_id: null,
    financial_resolution_state: "not_required",
    financial_resolution_attempts: 0,
    financial_resolution_lease_token: null,
    financial_resolution_lease_until: null,
    spaces: { host_id: "host-1" },
  };
}

function fakeAdmin() {
  const row = initialRow();
  let operation: Record<string, unknown> | null = null;

  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_booking_cancellation") {
        if (
          row.active_money_operation_id !== null ||
          row.status !== "upcoming" ||
          row.financial_resolution_state === "pending" ||
          String(row.starts_at) <= String(args.p_now)
        ) {
          return { data: [], error: null };
        }

        operation = {
          id: "operation-1",
          booking_id: row.id,
          refund_request_id: null,
          kind: "cancellation",
          state: "claimed",
          operation_key: `booking:${row.id}:cancellation`,
          requested_outcome: null,
          decision_actor_id: null,
          decision_note: null,
          cancellation_actor: args.p_actor,
          provider_action: args.p_provider_action,
          space_id: "space-1",
          practitioner_id: row.practitioner_id,
          payment_intent_id: row.stripe_payment_intent_id,
          source_transfer_id: null,
          destination_account_id: null,
          host_rate_cents: row.host_rate_cents,
          service_fee_cents: row.service_fee_cents,
          instant_fee_cents: row.instant_fee_cents,
          pro_discount_cents: row.pro_discount_cents,
          total_cents: row.total_cents,
          platform_cents: row.platform_cents,
          refunded_before_cents: row.refunded_cents,
          expected_transfer_cents: 0,
          expected_refund_cents: args.p_expected_refund_cents,
          expected_reversal_cents: 0,
          expected_charged_cents: args.p_expected_charged_cents,
          stripe_transfer_id: null,
          stripe_refund_id: null,
          stripe_reversal_id: null,
          provider_status: null,
          provider_paid_cents: null,
          attempts: 0,
          lease_token: args.p_lease_token,
          lease_until: "2026-09-15T12:10:00.000Z",
        };
        row.active_money_operation_id = operation.id;
        return { data: [{ ...operation }], error: null };
      }

      if (name === "complete_booking_cancellation") {
        if (
          !operation ||
          operation.id !== args.p_operation_id ||
          operation.lease_token !== args.p_lease_token
        ) {
          return { data: false, error: null };
        }
        row.status =
          operation.cancellation_actor === "host"
            ? "cancelled_by_host"
            : "cancelled_by_practitioner";
        row.cancelled_at = args.p_now;
        row.cancelled_by = operation.cancellation_actor;
        row.refunded_cents = args.p_refunded_cents;
        row.active_money_operation_id = null;
        row.financial_resolution_state = "resolved";
        operation.state = "committed";
        return { data: true, error: null };
      }

      if (name === "fail_booking_money_operation") {
        row.financial_resolution_state = "pending";
        row.financial_resolution_last_error = "stripe_financial_resolution_failed";
        row.active_money_operation_id = operation?.id ?? null;
        if (operation) operation.lease_token = null;
        return { data: true, error: null };
      }

      throw new Error(`Unexpected rpc ${name}`);
    }),
    from: vi.fn((table: string) => {
      if (table !== "bookings") throw new Error(`Unexpected table ${table}`);

      return {
        select: () => {
          let id: unknown;
          const chain = {
            eq(column: string, value: unknown) {
              if (column === "id") id = value;
              return chain;
            },
            maybeSingle: async () => ({
              data: row.id === id ? { ...row, spaces: { host_id: "host-1" } } : null,
              error: null,
            }),
          };
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          const guards: Array<[string, unknown, "eq" | "is" | "gt"]> = [];
          const chain = {
            eq(column: string, value: unknown) {
              guards.push([column, value, "eq"]);
              return chain;
            },
            is(column: string, value: unknown) {
              guards.push([column, value, "is"]);
              return chain;
            },
            gt(column: string, value: unknown) {
              guards.push([column, value, "gt"]);
              return chain;
            },
            select() {
              return chain;
            },
            maybeSingle: async () => {
              const matches = guards.every(([column, value, operator]) =>
                operator === "gt"
                  ? String(row[column]) > String(value)
                  : row[column] === value,
              );
              if (!matches) return { data: null, error: null };
              Object.assign(row, patch);
              return {
                data: {
                  ...row,
                  attempts: row.financial_resolution_attempts,
                  lease_token: row.financial_resolution_lease_token,
                },
                error: null,
              };
            },
          };
          return chain;
        },
      };
    }),
  } as unknown as SupabaseClient;

  return { admin, row };
}

function fakeStripe(): StripeGateway {
  return {
    charge: vi.fn(),
    capture: vi.fn(),
    release: vi.fn(),
    payHost: vi.fn(),
    settle: vi.fn(async () => {
      // Leave a scheduling point between the durable claim and finalization so
      // the competing actor genuinely races while Stripe is in flight.
      await Promise.resolve();
      return {
        refundId: "re_1",
        providerStatus: "succeeded",
        paymentIntentStatus: "succeeded",
        paidCents: 6_000,
        refundedCents: 6_000,
      };
    }),
  } as unknown as StripeGateway;
}

describe("durable cancellation ownership", () => {
  it("lets only one concurrent actor settle Stripe and send the receipt", async () => {
    const { admin, row } = fakeAdmin();
    const stripe = fakeStripe();

    const results = await Promise.allSettled([
      cancelBooking(admin, stripe, "booking-1", "practitioner", "practitioner-1", NOW),
      cancelBooking(admin, stripe, "booking-1", "host", "host-1", NOW),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(BookingError);
    expect(rejected?.reason).toMatchObject({ status: 409 });

    expect(stripe.settle).toHaveBeenCalledTimes(1);
    expect(row.financial_resolution_state).toBe("resolved");
    expect(row.cancelled_by).toMatch(/^(host|practitioner)$/);
    expect(notifyCancellation).toHaveBeenCalledTimes(1);
    expect(notifyCancellation).toHaveBeenCalledWith(
      admin,
      "booking-1",
      row.cancelled_by,
      expect.any(Object),
    );
  });

  it("keeps the receipt gated when Stripe must be retried", async () => {
    const { admin, row } = fakeAdmin();
    const stripe = fakeStripe();
    vi.mocked(stripe.settle).mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      cancelBooking(admin, stripe, "booking-1", "host", "host-1", NOW),
    ).rejects.toMatchObject({ status: 503 });

    // The still-payable intent keeps the slot occupied until Stripe confirms
    // the cancellation/refund.
    expect(row.status).toBe("upcoming");
    expect(row.financial_resolution_state).toBe("pending");
    expect(row.financial_resolution_last_error).toBe(
      "stripe_financial_resolution_failed",
    );
    expect(notifyCancellation).not.toHaveBeenCalled();
  });

  it("refuses cancellation after an approved hold while capture is still reconciling", async () => {
    const { admin, row } = fakeAdmin();
    row.approval_state = "approved";
    row.captured_at = null;
    row.financial_resolution_state = "pending";
    const stripe = fakeStripe();

    await expect(
      cancelBooking(admin, stripe, "booking-1", "host", "host-1", NOW),
    ).rejects.toMatchObject({ status: 409 });

    expect(stripe.settle).not.toHaveBeenCalled();
    expect(row.cancelled_at).toBeNull();
  });

  it("refuses cancellation after the session has started", async () => {
    const { admin, row } = fakeAdmin();
    row.starts_at = NOW.toISOString();
    const stripe = fakeStripe();

    await expect(
      cancelBooking(admin, stripe, "booking-1", "practitioner", "practitioner-1", NOW),
    ).rejects.toMatchObject({ status: 409 });
    expect(stripe.settle).not.toHaveBeenCalled();
  });
});
