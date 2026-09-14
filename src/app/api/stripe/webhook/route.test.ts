import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The signature check is this endpoint's entire security model, so the tests
 * sign real payloads with Stripe's own header generator rather than mocking
 * verification away. A test that stubs `constructEventAsync` would pass no
 * matter how badly the secret handling was broken.
 */

interface DbResult {
  data?: unknown;
  error: unknown;
}

const dbState = {
  results: [] as DbResult[],
};

const nextDbResult = (): DbResult => dbState.results.shift() ?? { data: null, error: null };

const updateChain = {
  update: vi.fn((_patch?: Record<string, unknown>) => updateChain),
  eq: vi.fn((_col?: string, _val?: unknown) => updateChain),
  is: vi.fn((_col?: string, _val?: unknown) => updateChain),
  select: vi.fn((_columns?: string) => updateChain),
  maybeSingle: vi.fn(() => Promise.resolve(nextDbResult())),
  then: (
    resolve: (result: DbResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(nextDbResult()).then(resolve, reject),
};

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from: () => updateChain }),
}));

// No API version pinned: nothing here reaches the network, and hardcoding one
// makes this file fail to compile every time the SDK moves.
const stripeForSigning = new Stripe("sk_test_unused");

vi.mock("@/lib/stripe/client", () => ({
  stripe: () => stripeForSigning,
}));

const effects = vi.hoisted(() => ({
  notifyBookingCreated: vi.fn(),
  notifyRequestMade: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@/lib/notify/for-booking", () => ({
  notifyBookingCreated: effects.notifyBookingCreated,
  notifyRequestMade: effects.notifyRequestMade,
  recipientFor: vi.fn(async () => null),
}));

vi.mock("@/lib/analytics/record", () => ({ recordEvent: effects.recordEvent }));

const { POST } = await import("./route");

const PLATFORM_SECRET = "whsec_platform_endpoint_secret";
const CONNECT_SECRET = "whsec_connect_endpoint_secret";

function signed(secret: string, body: unknown): Request {
  const payload = JSON.stringify(body);
  return new Request("https://example.test/api/stripe/webhook", {
    method: "POST",
    body: payload,
    headers: {
      "stripe-signature": stripeForSigning.webhooks.generateTestHeaderString({ payload, secret }),
    },
  });
}

const accountUpdated = {
  id: "evt_1",
  type: "account.updated",
  data: { object: { id: "acct_1", charges_enabled: true, payouts_enabled: true } },
};

const paymentBooking = {
  id: "bk_1",
  approval_state: "not_required",
  practitioner_id: "pr_1",
  space_id: "sp_1",
  status: "upcoming",
  total_cents: 5_000,
  captured_at: null,
  stripe_payment_intent_id: null,
};

const paymentSucceeded = (over: Record<string, unknown> = {}) => ({
  id: "evt_payment",
  type: "payment_intent.succeeded",
  data: {
    object: {
      id: "pi_1",
      amount: 5_000,
      currency: "usd",
      metadata: {
        booking_id: "bk_1",
        space_id: "sp_1",
        practitioner_id: "pr_1",
      },
      ...over,
    },
  },
});

function respondWith(...results: DbResult[]): void {
  dbState.results.push(...results);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (request: Request) => POST(request as any);

describe("stripe webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    dbState.results = [];
  });

  it("refuses everything when no secret is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    const response = await post(signed(PLATFORM_SECRET, accountUpdated));

    expect(response.status).toBe(500);
  });

  it("accepts an event signed by the only configured secret", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    const response = await post(signed(PLATFORM_SECRET, accountUpdated));

    expect(response.status).toBe(200);
  });

  it("returns 500 when the database write fails so Stripe retries the event", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    const databaseError = { code: "XX000", message: "database unavailable" };
    updateChain.eq.mockImplementationOnce(
      () => Promise.resolve({ error: databaseError }) as never,
    );

    const response = await post(signed(PLATFORM_SECRET, accountUpdated));

    expect(response.status).toBe(500);
  });

  /**
   * The reason the variable holds a list at all. Connect events arrive from a
   * second endpoint with its own secret, and `account.updated` is the only
   * thing that ever marks a host payable — if this fails, hosts silently never
   * become bookable.
   */
  it("accepts an event signed by any configured secret, not just the first", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", `${PLATFORM_SECRET},${CONNECT_SECRET}`);

    const response = await post(signed(CONNECT_SECRET, accountUpdated));

    expect(response.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith({ stripe_connect_charges_enabled: true });
  });

  it("tolerates whitespace around a pasted pair of secrets", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", ` ${PLATFORM_SECRET} , ${CONNECT_SECRET} `);

    const response = await post(signed(CONNECT_SECRET, accountUpdated));

    expect(response.status).toBe(200);
  });

  it("rejects a payload signed by a secret we do not hold", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    const response = await post(signed("whsec_attacker_made_this_up", accountUpdated));

    expect(response.status).toBe(400);
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it("rejects an unsigned request", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    const response = await post(
      new Request("https://example.test/api/stripe/webhook", {
        method: "POST",
        body: JSON.stringify(accountUpdated),
      }),
    );

    expect(response.status).toBe(400);
  });

  /** Both flags or nothing — charges without payouts is money the host cannot reach. */
  it("does not mark a host payable when payouts are still disabled", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    await post(
      signed(PLATFORM_SECRET, {
        ...accountUpdated,
        data: { object: { id: "acct_1", charges_enabled: true, payouts_enabled: false } },
      }),
    );

    expect(updateChain.update).toHaveBeenCalledWith({ stripe_connect_charges_enabled: false });
  });

  describe("payment_intent.succeeded booking association", () => {
    it("captures a directly-associated booking and runs its effects once", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
      respondWith({
        data: [
          {
            id: "bk_1",
            approval_state: "not_required",
            practitioner_id: "pr_1",
          },
        ],
        error: null,
      });

      const response = await post(signed(PLATFORM_SECRET, paymentSucceeded()));

      expect(response.status).toBe(200);
      expect(effects.recordEvent).toHaveBeenCalledTimes(2);
      expect(effects.notifyBookingCreated).toHaveBeenCalledTimes(1);
      expect(effects.notifyBookingCreated).toHaveBeenCalledWith(expect.anything(), "bk_1");
    });

    it("acknowledges a normal replay without duplicating analytics or notifications", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
      respondWith(
        { data: [], error: null },
        {
          data: {
            ...paymentBooking,
            captured_at: "2026-09-14T12:00:00.000Z",
            stripe_payment_intent_id: "pi_1",
          },
          error: null,
        },
      );

      const response = await post(signed(PLATFORM_SECRET, paymentSucceeded()));

      expect(response.status).toBe(200);
      expect(effects.recordEvent).not.toHaveBeenCalled();
      expect(effects.notifyBookingCreated).not.toHaveBeenCalled();
    });

    it("repairs a missing association from matching Stripe metadata before acknowledging", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
      respondWith(
        { data: [], error: null }, // no direct PaymentIntent association
        { data: null, error: null }, // not a replay by PaymentIntent id
        { data: paymentBooking, error: null }, // signed metadata finds the booking
        {
          data: [
            {
              id: "bk_1",
              approval_state: "not_required",
              practitioner_id: "pr_1",
            },
          ],
          error: null,
        },
      );

      const response = await post(signed(PLATFORM_SECRET, paymentSucceeded()));

      expect(response.status).toBe(200);
      expect(updateChain.update).toHaveBeenNthCalledWith(2, {
        stripe_payment_intent_id: "pi_1",
        captured_at: expect.any(String),
      });
      expect(updateChain.is).toHaveBeenCalledWith("stripe_payment_intent_id", null);
      expect(effects.recordEvent).toHaveBeenCalledTimes(2);
      expect(effects.notifyBookingCreated).toHaveBeenCalledTimes(1);
    });

    it("treats a concurrent recovery winner as a replay, not an infinite 500", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
      respondWith(
        { data: [], error: null },
        { data: null, error: null },
        { data: paymentBooking, error: null },
        { data: [], error: null }, // this delivery lost the guarded update race
        {
          data: {
            ...paymentBooking,
            captured_at: "2026-09-14T12:00:00.000Z",
            stripe_payment_intent_id: "pi_1",
          },
          error: null,
        },
      );

      const response = await post(signed(PLATFORM_SECRET, paymentSucceeded()));

      expect(response.status).toBe(200);
      expect(effects.recordEvent).not.toHaveBeenCalled();
      expect(effects.notifyBookingCreated).not.toHaveBeenCalled();
    });

    it("returns 500 when neither an association nor recovery metadata exists", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
      respondWith({ data: [], error: null }, { data: null, error: null });

      const response = await post(
        signed(
          PLATFORM_SECRET,
          paymentSucceeded({ metadata: {} }),
        ),
      );

      expect(response.status).toBe(500);
      expect(effects.recordEvent).not.toHaveBeenCalled();
      expect(effects.notifyBookingCreated).not.toHaveBeenCalled();
    });

    it.each([
      ["another intent", { stripe_payment_intent_id: "pi_other" }, {}],
      ["another space", { space_id: "sp_other" }, {}],
      ["another practitioner", { practitioner_id: "pr_other" }, {}],
      ["a closed booking", { status: "cancelled_by_practitioner" }, {}],
      ["another amount", { total_cents: 7_500 }, {}],
      ["another currency", {}, { currency: "cad" }],
    ])("refuses metadata recovery for %s", async (_label, bookingOver, intentOver) => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
      respondWith(
        { data: [], error: null },
        { data: null, error: null },
        { data: { ...paymentBooking, ...bookingOver }, error: null },
      );

      const response = await post(
        signed(PLATFORM_SECRET, paymentSucceeded(intentOver as Record<string, unknown>)),
      );

      expect(response.status).toBe(500);
      // Only the initial direct capture was attempted; a mismatched booking is
      // never rewritten to fit the PaymentIntent.
      expect(updateChain.update).toHaveBeenCalledTimes(1);
      expect(effects.recordEvent).not.toHaveBeenCalled();
      expect(effects.notifyBookingCreated).not.toHaveBeenCalled();
    });

    it("returns 500 when recovery is not durably written", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
      const writeError = { code: "XX000", message: "database unavailable" };
      respondWith(
        { data: [], error: null },
        { data: null, error: null },
        { data: paymentBooking, error: null },
        { data: null, error: writeError },
        { data: null, error: null },
      );

      const response = await post(signed(PLATFORM_SECRET, paymentSucceeded()));

      expect(response.status).toBe(500);
      expect(effects.recordEvent).not.toHaveBeenCalled();
      expect(effects.notifyBookingCreated).not.toHaveBeenCalled();
    });
  });

  /**
   * The two products ride one customer, so the subscription's own identity — not
   * the customer — decides which column moves. A Studio Pro event must never
   * touch a practitioner's is_pro, and a practitioner event must never touch
   * studio_pro. This is the whole reason isStudioProSubscription exists.
   */
  const subEvent = (object: Record<string, unknown>) => ({
    id: "evt_sub",
    type: "customer.subscription.updated",
    data: { object: { customer: "cus_1", cancel_at_period_end: false, ...object } },
  });

  it("routes a Studio Pro subscription event to studio_pro, never is_pro", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    await post(
      signed(
        PLATFORM_SECRET,
        subEvent({
          id: "sub_studio",
          status: "active",
          metadata: { app_user_id: "user_1", kind: "studio_pro" },
          current_period_end: 1_893_456_000,
          items: { data: [] },
        }),
      ),
    );

    const patch = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.studio_pro).toBe(true);
    expect(patch).not.toHaveProperty("is_pro");
    expect(updateChain.eq).toHaveBeenCalledWith("id", "user_1");
  });

  it("routes a practitioner Pro subscription event to is_pro, never studio_pro", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    await post(
      signed(
        PLATFORM_SECRET,
        subEvent({
          id: "sub_pro",
          status: "active",
          metadata: { app_user_id: "user_1" },
          items: { data: [{ price: { lookup_key: "minimum_stress_pro_monthly" } }] },
        }),
      ),
    );

    const patch = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.is_pro).toBe(true);
    expect(patch).not.toHaveProperty("studio_pro");
  });

  it("a cancelled Studio Pro subscription clears studio_pro (downgrade)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    await post(
      signed(
        PLATFORM_SECRET,
        subEvent({
          id: "sub_studio",
          type: "customer.subscription.deleted",
          status: "canceled",
          metadata: { app_user_id: "user_1", kind: "studio_pro" },
          items: { data: [] },
        }),
      ),
    );

    const patch = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.studio_pro).toBe(false);
    expect(patch.studio_pro_since).toBeNull();
  });

  it("falls back to the customer id when a hand-made subscription has no metadata", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);

    await post(
      signed(
        PLATFORM_SECRET,
        subEvent({
          id: "sub_studio",
          status: "active",
          metadata: {},
          items: { data: [{ price: { lookup_key: "minimum_stress_studio_pro_monthly" } }] },
        }),
      ),
    );

    // No app_user_id, but the price lookup_key still routes it to studio_pro,
    // matched by the customer id.
    const patch = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.studio_pro).toBe(true);
    expect(updateChain.eq).toHaveBeenCalledWith("stripe_customer_id", "cus_1");
  });

  /* ---------------- Founding discount forfeiture (0072) ---------------- */

  // The founding-discount forfeiture write, if any, across every update() call
  // this event produced (the first update is always the is_pro/studio_pro patch).
  const forfeiture = () =>
    (updateChain.update.mock.calls.map((c) => c[0]) as Record<string, unknown>[]).find(
      (p) =>
        "founding_practitioner_discount_forfeited_at" in p ||
        "founding_host_discount_forfeited_at" in p,
    );

  const pro = (over: Record<string, unknown>) =>
    subEvent({
      id: "sub_pro",
      items: { data: [{ price: { lookup_key: "minimum_stress_pro_monthly" } }] },
      ...over,
    });
  const studio = (over: Record<string, unknown>) =>
    subEvent({ id: "sub_studio", items: { data: [] }, ...over });

  it("forfeits the practitioner discount when a founding-discounted Pro sub terminally ends", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(PLATFORM_SECRET, pro({ status: "canceled", metadata: { app_user_id: "user_1", founding_discount: "true" } })),
    );
    const f = forfeiture();
    expect(f).toBeDefined();
    expect(f).toHaveProperty("founding_practitioner_discount_forfeited_at");
    expect(f).not.toHaveProperty("founding_host_discount_forfeited_at"); // no cross-contamination
    expect(f!.founding_practitioner_discount_forfeited_at).not.toBeNull();
    // Idempotent + out-of-order safe: the write is scoped to where it is still null.
    expect(updateChain.is).toHaveBeenCalledWith("founding_practitioner_discount_forfeited_at", null);
  });

  it("forfeits the host discount when a founding-discounted Studio Pro sub terminally ends", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(
        PLATFORM_SECRET,
        studio({ status: "canceled", metadata: { app_user_id: "user_1", kind: "studio_pro", founding_discount: "true" } }),
      ),
    );
    const f = forfeiture();
    expect(f).toHaveProperty("founding_host_discount_forfeited_at");
    expect(f).not.toHaveProperty("founding_practitioner_discount_forfeited_at");
    expect(updateChain.is).toHaveBeenCalledWith("founding_host_discount_forfeited_at", null);
  });

  it("also forfeits on a true customer.subscription.deleted event", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(PLATFORM_SECRET, {
        id: "evt_del",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_pro",
            customer: "cus_1",
            status: "canceled",
            cancel_at_period_end: false,
            metadata: { app_user_id: "user_1", founding_discount: "true" },
            items: { data: [{ price: { lookup_key: "minimum_stress_pro_monthly" } }] },
          },
        },
      }),
    );
    expect(forfeiture()).toHaveProperty("founding_practitioner_discount_forfeited_at");
  });

  it("does NOT forfeit on past_due — a payment failure that may still recover", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(PLATFORM_SECRET, pro({ status: "past_due", metadata: { app_user_id: "user_1", founding_discount: "true" } })),
    );
    expect(forfeiture()).toBeUndefined();
  });

  it("does NOT forfeit on unpaid — not a terminal 'ended' state here", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(PLATFORM_SECRET, pro({ status: "unpaid", metadata: { app_user_id: "user_1", founding_discount: "true" } })),
    );
    expect(forfeiture()).toBeUndefined();
  });

  it("does NOT forfeit when the ended sub never carried the founding discount", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(signed(PLATFORM_SECRET, pro({ status: "canceled", metadata: { app_user_id: "user_1" } })));
    expect(forfeiture()).toBeUndefined();
  });

  it("a later active event never writes (nor clears) a forfeiture — out-of-order safe", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(PLATFORM_SECRET, pro({ status: "active", metadata: { app_user_id: "user_1", founding_discount: "true" } })),
    );
    // The webhook only ever SETS the forfeiture column, and only on a terminal
    // event — an active event touches neither column, so it can't un-forfeit.
    expect(forfeiture()).toBeUndefined();
  });

  it("a duplicate terminal event forfeits idempotently — always guarded by is(column,null), never cleared", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    const ev = pro({ status: "canceled", metadata: { app_user_id: "user_1", founding_discount: "true" } });
    await post(signed(PLATFORM_SECRET, ev));
    await post(signed(PLATFORM_SECRET, ev));
    // Both writes go through the same null-guarded path (the DB no-ops the second),
    // and no forfeiture write ever sets the column to null.
    expect(updateChain.is).toHaveBeenCalledWith("founding_practitioner_discount_forfeited_at", null);
    for (const p of updateChain.update.mock.calls.map((c) => c[0]) as Record<string, unknown>[]) {
      if ("founding_practitioner_discount_forfeited_at" in p) {
        expect(p.founding_practitioner_discount_forfeited_at).not.toBeNull();
      }
    }
  });

  const soon = Math.floor(Date.now() / 1000) + 30 * 86_400; // 30 days out
  const longAgo = Math.floor(Date.now() / 1000) - 60 * 86_400;

  it("does NOT forfeit when a discounted sub is cancelled DURING its trial (never converted)", async () => {
    // Early opt-in during the free window: a trialing sub, cancelled before it
    // ever bills. The 50% must survive for the member's real first conversion.
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(
        PLATFORM_SECRET,
        pro({ status: "canceled", trial_end: soon, metadata: { app_user_id: "user_1", founding_discount: "true" } }),
      ),
    );
    expect(forfeiture()).toBeUndefined();
  });

  it("does NOT forfeit a still-trialing terminal event", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(
        PLATFORM_SECRET,
        pro({ status: "trialing", trial_end: soon, metadata: { app_user_id: "user_1", founding_discount: "true" } }),
      ),
    );
    expect(forfeiture()).toBeUndefined();
  });

  it("does NOT forfeit when the first charge never succeeded (incomplete_expired), even on a deleted event", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    // A real deleted event (terminal), so the convert-to-paid gate is exercised.
    await post(
      signed(PLATFORM_SECRET, {
        id: "evt_del2",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_pro",
            customer: "cus_1",
            status: "incomplete_expired",
            cancel_at_period_end: false,
            metadata: { app_user_id: "user_1", founding_discount: "true" },
            items: { data: [{ price: { lookup_key: "minimum_stress_pro_monthly" } }] },
          },
        },
      }),
    );
    expect(forfeiture()).toBeUndefined();
  });

  it("DOES forfeit a discounted sub that converted (trial completed) then was cancelled", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET);
    await post(
      signed(
        PLATFORM_SECRET,
        pro({
          status: "canceled",
          trial_end: longAgo, // trial finished long ago…
          ended_at: longAgo + 30 * 86_400, // …and it billed for a month before ending
          metadata: { app_user_id: "user_1", founding_discount: "true" },
        }),
      ),
    );
    expect(forfeiture()).toHaveProperty("founding_practitioner_discount_forfeited_at");
  });
});
