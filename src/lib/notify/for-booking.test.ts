import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("./send", () => ({ notify }));

import {
  notifyBookingCreated,
  notifyCancellation,
  notifyRequestMade,
  reconcileCancellationNotifications,
  reconcileRequestOutcomeNotifications,
} from "./for-booking";

const BOOKING = {
  id: "booking-1",
  practitioner_id: "practitioner-1",
  starts_at: "2026-09-17T17:00:00.000Z",
  ends_at: "2026-09-17T18:00:00.000Z",
  total_cents: 5900,
  host_rate_cents: 4500,
  access_code: "4821",
  cancelled_by: "practitioner",
  captured_at: "2026-09-14T12:00:00.000Z",
  authorized_at: null,
  refunded_cents: 5699,
  financial_resolution_state: "resolved",
  spaces: {
    name: "Willow Room",
    host_id: "host-1",
    timezone: "America/Los_Angeles",
    address_line: "12 Alder Lane",
    entry_instructions: "Use the side door",
  },
};

function fakeAdmin(
  reconcileRows: Record<string, unknown>[] = [],
  bookingRow: Record<string, unknown> = BOOKING,
) {
  const statusFilters: string[][] = [];
  const from = vi.fn((table: string) => {
    let userId = "";
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: string) => {
        if (column === "id") userId = value;
        return chain;
      }),
      in: vi.fn((_column: string, values: string[]) => {
        statusFilters.push(values);
        return chain;
      }),
      not: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(async () => ({ data: reconcileRows, error: null })),
      maybeSingle: vi.fn(async () => {
        if (table === "bookings") {
          const reconciled = reconcileRows.find((row) => row.id === userId);
          return {
            data: reconciled ? { ...BOOKING, ...reconciled } : bookingRow,
            error: null,
          };
        }
        if (table === "profiles") {
          return {
            data: {
              display_name: userId === "host-1" ? "Harper Host" : "Priya Practitioner",
              phone: null,
              phone_verified_at: null,
              notify_sms: false,
              notify_bookings: true,
              notify_payouts: true,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };
    return chain;
  });

  const admin = {
    from,
    rpc: vi.fn(async (name: string) => ({
      data: [
        "list_cancellation_notification_gaps",
        "list_request_outcome_notification_gaps",
      ].includes(name)
        ? reconcileRows
        : null,
      error: null,
    })),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: { user: { email: `${id}@example.com` } },
          error: null,
        })),
      },
    },
  } as unknown as SupabaseClient;

  return { admin, statusFilters };
}

beforeEach(() => {
  notify.mockReset();
  notify.mockResolvedValue({ email: "sent" });
});

describe("cancellation notifications", () => {
  it("loads the already-cancelled booking and sends role-safe receipts to both sides", async () => {
    const { admin, statusFilters } = fakeAdmin();

    await notifyCancellation(admin, BOOKING.id, "practitioner", {
      chargedCents: 201,
      refundedCents: 5699,
    });

    expect(statusFilters).toContainEqual([
      "cancelled_by_practitioner",
      "cancelled_by_host",
    ]);
    expect(notify).toHaveBeenCalledTimes(2);

    expect(notify.mock.calls[0][0]).toMatchObject({
      kind: "cancelled_by_practitioner",
      subjectId: "booking-1",
      bookingId: "booking-1",
      recipient: { userId: "practitioner-1" },
      context: { chargedCents: 201, refundedCents: 5699 },
    });
    expect(notify.mock.calls[1][0]).toMatchObject({
      kind: "cancelled_by_practitioner",
      subjectId: "booking-1:host",
      recipient: { userId: "host-1" },
    });
    expect(notify.mock.calls[1][0].context).not.toHaveProperty("chargedCents");
    expect(notify.mock.calls[1][0].context).not.toHaveProperty("refundedCents");
  });

  it("sends a host cancellation only to the practitioner", async () => {
    const { admin } = fakeAdmin([], {
      ...BOOKING,
      cancelled_by: "host",
      refunded_cents: 5900,
    });

    await notifyCancellation(admin, BOOKING.id, "host", {
      chargedCents: 0,
      refundedCents: 5900,
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "cancelled_by_host",
      recipient: expect.objectContaining({ userId: "practitioner-1" }),
      context: expect.objectContaining({ chargedCents: 0, refundedCents: 5900 }),
    }));
  });

  it("refuses a stale caller actor that disagrees with the durable cancellation", async () => {
    const { admin } = fakeAdmin([], {
      ...BOOKING,
      cancelled_by: "host",
      refunded_cents: 5900,
    });

    await notifyCancellation(admin, BOOKING.id, "practitioner", {
      chargedCents: 5900,
      refundedCents: 0,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("waits for the durable Stripe resolution before sending a receipt", async () => {
    const { admin } = fakeAdmin([], {
      ...BOOKING,
      financial_resolution_state: "pending",
    });

    await notifyCancellation(admin, BOOKING.id, "practitioner", {
      chargedCents: 201,
      refundedCents: 5699,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("does not send a cancellation receipt for an unpaid checkout", async () => {
    const { admin } = fakeAdmin([], {
      ...BOOKING,
      captured_at: null,
      authorized_at: null,
    });

    await notifyCancellation(admin, BOOKING.id, "practitioner", {
      chargedCents: 0,
      refundedCents: 0,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("does not turn an abandoned checkout or declined request into a cancellation receipt", async () => {
    const { admin } = fakeAdmin([
      {
        id: "abandoned-1",
        status: "cancelled_by_practitioner",
        cancelled_by: "practitioner",
        total_cents: 5900,
        refunded_cents: 0,
        captured_at: null,
        authorized_at: null,
      },
      {
        id: "declined-request-1",
        status: "cancelled_by_host",
        cancelled_by: null,
        total_cents: 5900,
        refunded_cents: 0,
        captured_at: null,
        authorized_at: "2026-09-14T12:00:00.000Z",
      },
    ]);

    await expect(reconcileCancellationNotifications(admin)).resolves.toEqual({
      reconciled: 0,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("reconciles captured and authorized cancellations with truthful settlement amounts", async () => {
    const { admin } = fakeAdmin([
      {
        id: "captured-1",
        status: "cancelled_by_practitioner",
        cancelled_by: "practitioner",
        total_cents: 5900,
        refunded_cents: 5699,
        captured_at: "2026-09-14T12:00:00.000Z",
        authorized_at: null,
      },
      {
        id: "authorized-1",
        status: "cancelled_by_host",
        cancelled_by: "host",
        total_cents: 5900,
        refunded_cents: 0,
        captured_at: null,
        authorized_at: "2026-09-14T12:00:00.000Z",
      },
    ]);

    await expect(reconcileCancellationNotifications(admin)).resolves.toEqual({
      reconciled: 2,
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "cancelled_by_practitioner",
      context: expect.objectContaining({ chargedCents: 201, refundedCents: 5699 }),
    }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "cancelled_by_host",
      context: expect.objectContaining({ chargedCents: 0, refundedCents: 0 }),
    }));
  });
});

describe("strict webhook notification paths", () => {
  function failingAdmin(): SupabaseClient {
    const failure = new Error("database unavailable");
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      not: vi.fn(() => chain),
      is: vi.fn(() => chain),
      in: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: failure })),
    };
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  }

  it("surfaces a booking loader error so Stripe can replay the confirmation", async () => {
    await expect(notifyBookingCreated(failingAdmin(), "booking-1")).rejects.toThrow(
      "database unavailable",
    );
  });

  it("surfaces a request loader error in strict mode", async () => {
    await expect(
      notifyRequestMade(failingAdmin(), "booking-1", { propagate: true }),
    ).rejects.toThrow("database unavailable");
  });
});

describe("request outcome notification repair", () => {
  it("reconciles an approved request only after capture is durably resolved", async () => {
    const { admin } = fakeAdmin([
      {
        id: "approved-1",
        approval_state: "approved",
        approval_decided_at: "2026-09-14T12:00:00.000Z",
        approval_note: null,
        status: "upcoming",
        cancelled_at: null,
        captured_at: "2026-09-14T12:00:01.000Z",
        financial_resolution_state: "resolved",
        created_at: "2026-09-14T11:00:00.000Z",
        purpose: "other",
        purpose_note: "Recording",
      },
    ]);

    await expect(reconcileRequestOutcomeNotifications(admin)).resolves.toEqual({
      reconciled: 1,
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "request_approved",
      subjectId: "approved-1",
      bookingId: "approved-1",
    }));
  });

  it("still reconciles terminal decline and expiry receipts", async () => {
    const { admin } = fakeAdmin([
      {
        id: "declined-1",
        approval_state: "declined",
        approval_decided_at: "2026-09-14T12:00:00.000Z",
        approval_note: "Unavailable",
        status: "cancelled_by_host",
        cancelled_at: "2026-09-14T12:00:00.000Z",
        financial_resolution_state: "resolved",
        created_at: "2026-09-14T11:00:00.000Z",
        purpose: null,
        purpose_note: null,
      },
      {
        id: "expired-1",
        approval_state: "expired",
        approval_decided_at: "2026-09-14T13:00:00.000Z",
        approval_note: null,
        status: "cancelled_by_host",
        cancelled_at: "2026-09-14T13:00:00.000Z",
        financial_resolution_state: "resolved",
        created_at: "2026-09-14T11:00:00.000Z",
        purpose: null,
        purpose_note: null,
      },
    ]);

    await expect(reconcileRequestOutcomeNotifications(admin)).resolves.toEqual({
      reconciled: 2,
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "request_declined",
      subjectId: "declined-1",
    }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "request_expired",
      subjectId: "expired-1",
    }));
  });
});
