import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  refundRequested: vi.fn(),
  notifyRefundRequested: vi.fn(),
  notifyRefundDecided: vi.fn(),
}));

vi.mock("./stripe/client", () => ({
  refundRequested: mocks.refundRequested,
}));

vi.mock("./notify/for-refund", () => ({
  notifyRefundRequested: mocks.notifyRefundRequested,
  notifyRefundDecided: mocks.notifyRefundDecided,
}));

import { decideRefund, requestRefund } from "./refund-service";
import type { FinancialResolutionState } from "./financial-resolution";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function booking(financialState: FinancialResolutionState) {
  return {
    id: "booking-1",
    practitioner_id: "practitioner-1",
    space_id: "space-1",
    status: "completed",
    starts_at: "2026-09-14T12:00:00.000Z",
    total_cents: 6_000,
    host_rate_cents: 5_000,
    stripe_payment_intent_id: "pi_1",
    captured_at: "2026-09-10T12:00:00.000Z",
    stripe_transfer_id: null,
    host_paid_at: null,
    refunded_cents: 0,
    financial_resolution_state: financialState,
  };
}

function fakeAdmin(financialState: FinancialResolutionState) {
  const inserts = vi.fn();
  const updates = vi.fn();
  const touched: string[] = [];

  return {
    inserts,
    updates,
    touched,
    client: {
      from(table: string) {
        touched.push(table);

        if (table === "bookings") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: booking(financialState), error: null }),
              }),
            }),
          };
        }

        if (table === "refund_requests") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "refund-1", booking_id: "booking-1", state: "awaiting_staff" },
                  error: null,
                }),
              }),
            }),
            insert: inserts,
            update: updates,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(["pending", "manual_review"] as const)(
  "a booking whose financial resolution is %s",
  (financialState) => {
    it("cannot open a separate refund request", async () => {
      const admin = fakeAdmin(financialState);

      await expect(
        requestRefund(
          admin.client,
          "booking-1",
          "practitioner-1",
          { reason: "no_access", detail: "The session could not happen", evidencePath: null },
          NOW,
        ),
      ).rejects.toMatchObject({ status: 409 });

      expect(admin.touched).toEqual(["bookings"]);
      expect(admin.inserts).not.toHaveBeenCalled();
      expect(mocks.refundRequested).not.toHaveBeenCalled();
    });

    it("cannot be decided or settled by staff", async () => {
      const admin = fakeAdmin(financialState);

      await expect(
        decideRefund(admin.client, "refund-1", "staff-1", "full", "Approved", NOW),
      ).rejects.toMatchObject({ status: 409 });

      expect(admin.touched).toEqual(["refund_requests", "bookings"]);
      expect(admin.updates).not.toHaveBeenCalled();
      expect(mocks.refundRequested).not.toHaveBeenCalled();
      expect(mocks.notifyRefundDecided).not.toHaveBeenCalled();
    });
  },
);
