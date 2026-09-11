import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signature check is this endpoint's entire security model, so the tests
 * sign real payloads with Stripe's own header generator rather than mocking
 * verification away. A test that stubs `constructEventAsync` would pass no
 * matter how badly the secret handling was broken.
 */

const updateChain = {
  update: vi.fn((_patch?: Record<string, unknown>) => updateChain),
  eq: vi.fn((_col?: string, _val?: unknown) => updateChain),
  is: vi.fn(() => Promise.resolve({ error: null })),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (request: Request) => POST(request as any);

describe("stripe webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
