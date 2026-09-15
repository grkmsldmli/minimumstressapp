import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const serviceMocks = vi.hoisted(() => ({
  customerFor: vi.fn(),
  explainRejection: vi.fn(),
  planBooking: vi.fn(),
  planSeries: vi.fn(),
}));

vi.mock("./stripe/subscription", () => ({ customerFor: serviceMocks.customerFor }));
vi.mock("./booking-plan", () => ({
  explainRejection: serviceMocks.explainRejection,
  planBooking: serviceMocks.planBooking,
  planSeries: serviceMocks.planSeries,
}));

import { createBooking, type StripeGateway } from "./booking-service";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const START = new Date("2026-09-20T15:00:00.000Z");
const MONEY = {
  hostRateCents: 4_000,
  serviceFeeCents: 800,
  instantFeeCents: 200,
  proDiscountCents: 0,
  totalCents: 5_000,
  platformCents: 1_000,
};

interface FakeResult {
  data: unknown;
  error: unknown;
}

interface FakeOptions {
  association?: FakeResult;
  customerWrite?: FakeResult;
  deleteResult?: FakeResult;
}

interface DbCall {
  columns?: string;
  operation: "select" | "insert" | "update" | "delete";
  table: string;
  terminal: "await" | "maybeSingle" | "single";
}

/**
 * A narrow PostgREST fake for createBooking.
 *
 * Terminal calls are recorded because `.update().eq()` alone cannot prove a
 * row matched. The contract under test requires `.select("id").single()` for
 * both durable Stripe links, exactly as the real Supabase client does.
 */
function fakeAdmin(options: FakeOptions = {}) {
  const calls: DbCall[] = [];
  const events: string[] = [];
  const bookingUpdates: Record<string, unknown>[] = [];

  const resultFor = (
    table: string,
    operation: DbCall["operation"],
    columns?: string,
  ): FakeResult => {
    if (operation === "select" && table === "spaces") {
      return {
        data: {
          id: "sp_1",
          host_id: "host_1",
          hourly_rate_cents: 4_000,
          buffer_minutes: 0,
          timezone: "UTC",
          status: "active",
          capacity: 4,
          allowed_uses: [],
          booking_mode: "instant",
        },
        error: null,
      };
    }
    if (operation === "select" && table === "profiles") {
      if (columns?.includes("stripe_connect_account_id")) {
        return {
          data: {
            stripe_connect_account_id: "acct_1",
            stripe_connect_charges_enabled: true,
          },
          error: null,
        };
      }
      return {
        data: {
          id: "pr_1",
          is_pro: false,
          stripe_customer_id: null,
          account_type: "practitioner",
          identity_verified_at: NOW.toISOString(),
          profession: "yoga_teacher",
          credential_doc_state: "verified",
          insurance_doc_path: "insurance.pdf",
          insurance_doc_state: "verified",
          insurance_effective_date: "2026-01-01",
          insurance_expires_at: "2027-01-01",
        },
        error: null,
      };
    }
    if (operation === "select") return { data: [], error: null };

    if (operation === "insert" && table === "bookings") {
      return { data: { id: "bk_1" }, error: null };
    }
    if (operation === "update" && table === "profiles") {
      events.push("customer-write");
      return options.customerWrite ?? { data: { id: "pr_1" }, error: null };
    }
    if (operation === "update" && table === "bookings") {
      events.push("associate");
      return options.association ?? { data: { id: "bk_1" }, error: null };
    }
    if (operation === "delete" && table === "bookings") {
      events.push("delete");
      return options.deleteResult ?? { data: null, error: null };
    }
    return { data: null, error: null };
  };

  const builder = (
    table: string,
    operation: DbCall["operation"],
    payload?: Record<string, unknown>,
  ) => {
    if (table === "bookings" && operation === "update" && payload) {
      bookingUpdates.push(payload);
    }
    let columns: string | undefined;
    const complete = (terminal: DbCall["terminal"]) => {
      calls.push({ table, operation, columns, terminal });
      return resultFor(table, operation, columns);
    };

    const chain = {
      select(nextColumns?: string) {
        columns = nextColumns;
        return chain;
      },
      eq: () => chain,
      gt: () => chain,
      in: () => chain,
      is: () => chain,
      lt: () => chain,
      not: () => chain,
      or: () => chain,
      maybeSingle: () => Promise.resolve(complete("maybeSingle")),
      single: () => Promise.resolve(complete("single")),
      then: (
        resolve: (result: FakeResult) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(complete("await")).then(resolve, reject),
      // Keeps the payload visible to a debugger without making the fake depend
      // on exact booking columns that are unrelated to this reliability test.
      __payload: payload,
    };
    return chain;
  };

  return {
    calls,
    events,
    bookingUpdates,
    admin: {
      from: (table: string) => ({
        delete: () => builder(table, "delete"),
        insert: (payload: Record<string, unknown>) => builder(table, "insert", payload),
        select: (columns?: string) => builder(table, "select").select(columns),
        update: (payload: Record<string, unknown>) => builder(table, "update", payload),
      }),
    } as never,
  };
}

function fakeStripe(events: string[]): StripeGateway {
  return {
    charge: vi.fn(async () => {
      events.push("charge");
      return { paymentIntentId: "pi_1", clientSecret: "pi_1_secret_test" };
    }),
    capture: vi.fn(),
    release: vi.fn(async () => {
      events.push("release");
    }),
    settle: vi.fn(),
    payHost: vi.fn(),
  } as unknown as StripeGateway;
}

const request = {
  spaceId: "sp_1",
  startsAt: START,
  declared: { purpose: "movement_session" as const, attendees: 1 },
};

describe("createBooking payment association", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.customerFor.mockResolvedValue("cus_1");
    serviceMocks.planBooking.mockReturnValue({
      ok: true,
      money: MONEY,
      isInstant: false,
      needsApproval: false,
    });
  });

  it("returns the client secret only after exactly one profile and booking row are written", async () => {
    const { admin, calls, events } = fakeAdmin();
    const stripe = fakeStripe(events);

    const result = await createBooking(admin, stripe, "pr_1", request, NOW);

    expect(result).toMatchObject({
      bookingId: "bk_1",
      clientSecret: "pi_1_secret_test",
    });
    expect(events).toEqual(["customer-write", "charge", "associate"]);
    expect(calls).toContainEqual({
      table: "profiles",
      operation: "update",
      columns: "id",
      terminal: "single",
    });
    expect(calls).toContainEqual({
      table: "bookings",
      operation: "update",
      columns: "id",
      terminal: "single",
    });
  });

  it("does not mark a request authorized before Stripe confirms a real card hold", async () => {
    serviceMocks.planBooking.mockReturnValueOnce({
      ok: true,
      money: MONEY,
      isInstant: false,
      needsApproval: true,
    });
    const { admin, bookingUpdates, events } = fakeAdmin();

    await createBooking(admin, fakeStripe(events), "pr_1", request, NOW);

    expect(bookingUpdates).toContainEqual({ stripe_payment_intent_id: "pi_1" });
    expect(bookingUpdates.some((patch) => "authorized_at" in patch)).toBe(false);
  });

  it("cancels the PaymentIntent before deleting the booking when association fails", async () => {
    const associationError = new Error("association write failed");
    const { admin, events } = fakeAdmin({
      association: { data: null, error: associationError },
    });
    const stripe = fakeStripe(events);

    await expect(createBooking(admin, stripe, "pr_1", request, NOW)).rejects.toBe(
      associationError,
    );

    expect(events).toEqual([
      "customer-write",
      "charge",
      "associate",
      "release",
      "delete",
    ]);
    expect(stripe.release).toHaveBeenCalledWith("pi_1");
  });

  it("treats a zero-row association as failure even if Supabase supplies no error", async () => {
    const { admin, events } = fakeAdmin({
      association: { data: null, error: null },
    });
    const stripe = fakeStripe(events);

    await expect(createBooking(admin, stripe, "pr_1", request, NOW)).rejects.toThrow(
      /not associated/,
    );

    expect(stripe.release).toHaveBeenCalledWith("pi_1");
    expect(events.at(-1)).toBe("delete");
  });

  it("does not delete the recovery record when Stripe cannot confirm cancellation", async () => {
    const { admin, events } = fakeAdmin({
      association: { data: null, error: new Error("association write failed") },
    });
    const stripe = fakeStripe(events);
    vi.mocked(stripe.release).mockImplementationOnce(async () => {
      events.push("release");
      throw new Error("Stripe unavailable");
    });

    await expect(createBooking(admin, stripe, "pr_1", request, NOW)).rejects.toThrow(
      /PaymentIntent could not be cancelled/,
    );

    expect(events).toEqual(["customer-write", "charge", "associate", "release"]);
    expect(events).not.toContain("delete");
  });

  it("fails before creating a PaymentIntent when the new customer id is not persisted", async () => {
    const customerError = new Error("profile write failed");
    const { admin, events } = fakeAdmin({
      customerWrite: { data: null, error: customerError },
    });
    const stripe = fakeStripe(events);

    await expect(createBooking(admin, stripe, "pr_1", request, NOW)).rejects.toBe(customerError);

    expect(stripe.charge).not.toHaveBeenCalled();
    expect(stripe.release).not.toHaveBeenCalled();
    expect(events).toEqual(["customer-write", "delete"]);
  });

  it("fails a silent zero-row customer-id write before charging", async () => {
    const { admin, events } = fakeAdmin({
      customerWrite: { data: null, error: null },
    });
    const stripe = fakeStripe(events);

    await expect(createBooking(admin, stripe, "pr_1", request, NOW)).rejects.toThrow(
      /customer was not saved/,
    );

    expect(stripe.charge).not.toHaveBeenCalled();
    expect(events).toEqual(["customer-write", "delete"]);
  });
});
