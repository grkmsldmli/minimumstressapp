import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `booking-service` imports "server-only" so a client bundle cannot pull the
 * Stripe keys in with it. A test is neither a client nor a bundle, and the
 * import throws on sight, so it is stubbed out — the guarantee it provides is
 * about what ships, and nothing here ships.
 */
vi.mock("server-only", () => ({}));

import { answerRequest, expireStaleRequests } from "./approval-service";
import type { StripeGateway } from "./booking-service";
import { notifyRequestApproved, notifyRequestDeclined } from "./notify/for-booking";

/**
 * What happens to the money, and in what order.
 *
 * These are not tests of the clock — booking-approval.test.ts owns that. They
 * are about the three things that can go wrong once a host taps something: a
 * hold captured on a request nobody approved, a hold left on a card for a
 * booking that no longer exists, and a decline recorded as though the guest
 * had cancelled.
 */

const HOST = "host-1";
const HOUR = 3_600_000;
const NOW = new Date("2026-08-17T09:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

interface Row {
  id: string;
  created_at: string;
  starts_at: string;
  approval_state: string;
  status: string;
  cancelled_at: string | null;
  cancelled_by: "practitioner" | "host" | null;
  financial_resolution_state: string;
  financial_resolution_attempts: number;
  financial_resolution_lease_token: string | null;
  stripe_payment_intent_id: string | null;
  spaces: { host_id: string };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "bk-1",
  created_at: new Date(NOW.getTime() - HOUR).toISOString(),
  starts_at: new Date(NOW.getTime() + 72 * HOUR).toISOString(),
  approval_state: "pending",
  status: "upcoming",
  cancelled_at: null,
  cancelled_by: null,
  financial_resolution_state: "not_required",
  financial_resolution_attempts: 0,
  financial_resolution_lease_token: null,
  stripe_payment_intent_id: "pi_1",
  spaces: { host_id: HOST },
  ...over,
});

/**
 * Enough Supabase to run the service.
 *
 * Records every update it is given, in order, because the order is the thing
 * under test — the row has to be written before Stripe is called, or the
 * `payment_intent.canceled` webhook relabels a host's decline.
 */
function fakeDb(rows: Row[], writeError: Error | null = null) {
  const writes: { patch: Record<string, unknown>; guards: Record<string, unknown> }[] = [];
  const events: string[] = [];

  const builder = (patch?: Record<string, unknown>) => {
    const guards: Record<string, unknown> = {};
    let selected = rows;

    const chain = {
      select: () => chain,
      eq(column: string, value: unknown) {
        guards[column] = value;
        selected = selected.filter((r) => {
          if (column === "id") return r.id === value;
          if (column === "approval_state") return r.approval_state === value;
          if (column === "status") return r.status === value;
          if (column === "financial_resolution_state") {
            return r.financial_resolution_state === value;
          }
          return true;
        });
        return chain;
      },
      is(column: string, value: unknown) {
        guards[column] = value;
        selected = selected.filter((r) => (r as unknown as Record<string, unknown>)[column] === value);
        return chain;
      },
      maybeSingle: async () => {
        if (patch) {
          if (writeError) {
            events.push("write-error");
            return { data: null, error: writeError };
          }
          writes.push({ patch, guards });
          events.push("write");
          for (const r of selected) Object.assign(r, patch);
        }
        return { data: selected[0] ?? null, error: null };
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        if (patch) {
          if (writeError) {
            events.push("write-error");
            return Promise.resolve(resolve({ data: null, error: writeError } as never));
          }
          writes.push({ patch, guards });
          events.push("write");
          // Apply it, so a second answer finds a row that is no longer pending.
          for (const r of selected) Object.assign(r, patch);
        }
        const projected = selected.map((record) => ({
          ...record,
          attempts: record.financial_resolution_attempts,
          lease_token: record.financial_resolution_lease_token,
        }));
        return Promise.resolve(resolve({ data: projected, error: null }));
      },
    };
    return chain;
  };

  return {
    events,
    writes,
    db: {
      from: () => ({
        select: () => builder(),
        update: (patch: Record<string, unknown>) => builder(patch),
      }),
    } as never,
  };
}

function fakeStripe(events: string[]): StripeGateway {
  return {
    charge: vi.fn(),
    settle: vi.fn(),
    payHost: vi.fn(),
    capture: vi.fn(async () => {
      events.push("capture");
    }),
    release: vi.fn(async () => {
      events.push("release");
    }),
  } as unknown as StripeGateway;
}

vi.mock("./notify/for-booking", () => ({
  notifyRequestApproved: vi.fn(),
  notifyRequestDeclined: vi.fn(),
  notifyRequestExpired: vi.fn(),
  notifyRequestReminder: vi.fn(),
}));

describe("a host approving", () => {
  it("captures the hold, and writes the row before it does", async () => {
    const { db, events, writes } = fakeDb([row()]);
    await answerRequest(db, fakeStripe(events), "bk-1", HOST, "approve", null, NOW);

    expect(events).toEqual(["write", "capture", "write"]);
    expect(writes[0].patch.approval_state).toBe("approved");
    expect(writes.at(-1)?.patch.financial_resolution_state).toBe("resolved");
  });

  /*
   * The guard is on the row, not on a counter. Two taps on a phone with a slow
   * connection are the ordinary case, and the second one must not become a
   * second capture.
   */
  it("does not capture twice when the host taps twice", async () => {
    const rows = [row()];
    const { db, events } = fakeDb(rows);
    const stripe = fakeStripe(events);

    await answerRequest(db, stripe, "bk-1", HOST, "approve", null, NOW);
    await answerRequest(db, stripe, "bk-1", HOST, "approve", null, NOW).catch(() => {});

    expect(events.filter((e) => e === "capture")).toHaveLength(1);
  });

  it("refuses a booking on somebody else's space", async () => {
    const { db, events } = fakeDb([row({ spaces: { host_id: "someone-else" } })]);
    await expect(
      answerRequest(db, fakeStripe(events), "bk-1", HOST, "approve", null, NOW),
    ).rejects.toThrow(/No such booking/);
    expect(events).toEqual([]);
  });

  /** Nothing to capture. Approving would confirm a session nobody paid for. */
  it("refuses a request whose card form was never completed", async () => {
    const { db, events } = fakeDb([row({ stripe_payment_intent_id: null })]);
    await expect(
      answerRequest(db, fakeStripe(events), "bk-1", HOST, "approve", null, NOW),
    ).rejects.toThrow(/never paid for/);
    expect(events).toEqual([]);
  });

  it("does not capture when the approval row could not be written", async () => {
    const { db, events } = fakeDb([row()], new Error("database unavailable"));

    await expect(
      answerRequest(db, fakeStripe(events), "bk-1", HOST, "approve", null, NOW),
    ).rejects.toThrow("database unavailable");
    expect(events).toEqual(["write-error"]);
  });

  it("queues a failed capture without sending a false approval receipt", async () => {
    const { db, events, writes } = fakeDb([row()]);
    const stripe = fakeStripe(events);
    vi.mocked(stripe.capture).mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      answerRequest(db, stripe, "bk-1", HOST, "approve", null, NOW),
    ).resolves.toBeUndefined();

    expect(writes[0].patch).toMatchObject({
      approval_state: "approved",
      financial_resolution_state: "pending",
    });
    expect(writes.at(-1)?.patch.financial_resolution_state).toBe("pending");
    expect(notifyRequestApproved).not.toHaveBeenCalled();
  });

  it("cannot approve a request already claimed for cancellation", async () => {
    const { db, events } = fakeDb([
      row({
        cancelled_at: NOW.toISOString(),
        cancelled_by: "practitioner",
        financial_resolution_state: "pending",
      }),
    ]);

    await expect(
      answerRequest(db, fakeStripe(events), "bk-1", HOST, "approve", null, NOW),
    ).rejects.toMatchObject({ status: 409 });
    expect(events).toEqual([]);
  });
});

describe("a host declining", () => {
  it("releases the hold rather than refunding it", async () => {
    const { db, events } = fakeDb([row()]);
    const stripe = fakeStripe(events);
    await answerRequest(db, stripe, "bk-1", HOST, "decline", "Booked for a class", NOW);

    expect(events).toEqual(["write", "release", "write"]);
    expect(stripe.settle).not.toHaveBeenCalled();
  });

  /*
   * The order is the point. Releasing a hold cancels the intent, which fires
   * `payment_intent.canceled` within seconds — and that handler rewrites any
   * still-`upcoming` booking as cancelled by the practitioner. Writing the row
   * first is what makes that update match nothing.
   */
  it("claims the request before Stripe and frees the slot only after release", async () => {
    const { db, events, writes } = fakeDb([row()]);
    await answerRequest(db, fakeStripe(events), "bk-1", HOST, "decline", null, NOW);

    expect(events.indexOf("write")).toBeLessThan(events.indexOf("release"));
    expect(writes[0].patch.status).toBe("upcoming");
    expect(writes.at(-1)?.patch.status).toBe("cancelled_by_host");
  });

  /** Nobody cancelled a session, so nobody is named as having done so. */
  it("leaves cancelled_by null, so it is not counted as a late cancellation", async () => {
    const { db, events, writes } = fakeDb([row()]);
    await answerRequest(db, fakeStripe(events), "bk-1", HOST, "decline", null, NOW);

    expect(writes[0].patch.cancelled_by).toBeNull();
    expect(writes[0].patch.approval_state).toBe("declined");
  });

  it("does not release a hold when the decline row could not be written", async () => {
    const { db, events } = fakeDb([row()], new Error("database unavailable"));

    await expect(
      answerRequest(db, fakeStripe(events), "bk-1", HOST, "decline", null, NOW),
    ).rejects.toThrow("database unavailable");
    expect(events).toEqual(["write-error"]);
  });

  it("queues a failed hold release without sending a false success receipt", async () => {
    const { db, events } = fakeDb([row()]);
    const stripe = fakeStripe(events);
    vi.mocked(stripe.release).mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      answerRequest(db, stripe, "bk-1", HOST, "decline", null, NOW),
    ).resolves.toBeUndefined();

    expect(notifyRequestDeclined).not.toHaveBeenCalled();
  });

  it("cannot overwrite the actor on a request already claimed for cancellation", async () => {
    const existing = row({
      cancelled_at: NOW.toISOString(),
      cancelled_by: "practitioner",
      financial_resolution_state: "pending",
    });
    const { db, events } = fakeDb([existing]);

    await expect(
      answerRequest(db, fakeStripe(events), "bk-1", HOST, "decline", null, NOW),
    ).rejects.toMatchObject({ status: 409 });
    expect(existing.cancelled_by).toBe("practitioner");
    expect(events).toEqual([]);
  });
});

describe("the sweep", () => {
  it("expires a request nobody answered and gives the money back", async () => {
    const stale = row({ created_at: new Date(NOW.getTime() - 30 * HOUR).toISOString() });
    const { db, events, writes } = fakeDb([stale]);

    const { expired } = await expireStaleRequests(db, fakeStripe(events), NOW);

    expect(expired).toBe(1);
    expect(writes[0].patch.approval_state).toBe("expired");
    expect(events).toContain("release");
  });

  it("leaves one that still has time", async () => {
    const { db, events } = fakeDb([row()]);
    const { expired } = await expireStaleRequests(db, fakeStripe(events), NOW);

    expect(expired).toBe(0);
    expect(events).toEqual([]);
  });
});
