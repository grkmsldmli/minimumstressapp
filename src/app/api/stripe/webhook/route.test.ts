import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signature check is this endpoint's entire security model, so the tests
 * sign real payloads with Stripe's own header generator rather than mocking
 * verification away. A test that stubs `constructEventAsync` would pass no
 * matter how badly the secret handling was broken.
 */

const updateChain = {
  update: vi.fn(() => updateChain),
  eq: vi.fn(() => updateChain),
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
});
