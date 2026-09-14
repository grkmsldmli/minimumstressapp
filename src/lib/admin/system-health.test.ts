import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  STRIPE_CONNECT_WEBHOOK_EVENTS,
  STRIPE_PLATFORM_WEBHOOK_EVENTS,
  probeCoreSystemHealth,
  type CoreSystemHealthDependencies,
  type StripeHealthSource,
  type StripeWebhookEvidence,
} from "./system-health";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const WEBHOOK_URL = "https://minimumstress.app/api/stripe/webhook";

function endpoint(
  id: string,
  enabledEvents: string[],
  overrides: Partial<StripeWebhookEvidence> = {},
): StripeWebhookEvidence {
  return {
    id,
    enabledEvents,
    livemode: true,
    scope: "platform",
    signingSecretFingerprint: "fp_platform",
    status: "enabled",
    url: WEBHOOK_URL,
    ...overrides,
  };
}

function stripeSource(overrides: Partial<StripeHealthSource> = {}): StripeHealthSource {
  return {
    cacheKey: {},
    configured: true,
    expectedLivemode: true,
    expectedWebhookUrl: WEBHOOK_URL,
    signingSecretFingerprints: ["fp_platform", "fp_connect"],
    read: async () => ({
      apiLivemode: true,
      connectApiReachable: true,
      webhookEndpoints: [
        endpoint("we_platform", [...STRIPE_PLATFORM_WEBHOOK_EVENTS]),
        endpoint("we_connect", [...STRIPE_CONNECT_WEBHOOK_EVENTS], {
          scope: "connect",
          signingSecretFingerprint: "fp_connect",
        }),
      ],
    }),
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<CoreSystemHealthDependencies> = {},
): CoreSystemHealthDependencies {
  return {
    checkDatabase: async () => undefined,
    checkAuth: async () => undefined,
    readAnalyticsEvidence: async () => ({
      lastEventAt: new Date(NOW - 60_000).toISOString(),
    }),
    stripe: stripeSource(),
    ...overrides,
  };
}

const options = {
  now: () => NOW,
  stripeCacheTtlMs: 30_000,
  timeoutMs: 100,
};

function state(items: Awaited<ReturnType<typeof probeCoreSystemHealth>>, key: string) {
  return items.find((item) => item.key === key)!;
}

describe("probeCoreSystemHealth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns dated, HealthItem-compatible green evidence for all real probes", async () => {
    const items = await probeCoreSystemHealth(dependencies(), options);

    expect(items.map((item) => item.key)).toEqual([
      "database",
      "auth",
      "stripe_payments",
      "stripe_payouts",
      "web_analytics",
    ]);
    expect(items.every((item) => item.state === "healthy")).toBe(true);
    expect(items.every((item) => item.checkedAt === "2026-09-14T12:00:00.000Z")).toBe(true);
    expect(items.every((item) => item.latencyMs === 0)).toBe(true);
  });

  it("pins the exact Stripe events implemented by the webhook handler", () => {
    expect(STRIPE_PLATFORM_WEBHOOK_EVENTS).toEqual([
      "charge.refunded",
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
      "identity.verification_session.verified",
      "payment_intent.amount_capturable_updated",
      "payment_intent.canceled",
      "payment_intent.succeeded",
    ]);
    expect(STRIPE_CONNECT_WEBHOOK_EVENTS).toEqual([
      "account.updated",
      "payout.failed",
    ]);
  });

  it("accepts wildcard endpoints but still requires distinct platform and Connect endpoints", async () => {
    const twoWildcards = stripeSource({
      read: async () => ({
        apiLivemode: true,
        connectApiReachable: true,
        webhookEndpoints: [
          endpoint("we_platform", ["*"]),
          endpoint("we_connect", ["*"], {
            scope: "connect",
            signingSecretFingerprint: "fp_connect",
          }),
        ],
      }),
    });
    const ready = await probeCoreSystemHealth(
      dependencies({ stripe: twoWildcards }),
      options,
    );
    expect(state(ready, "stripe_payments").state).toBe("healthy");
    expect(state(ready, "stripe_payouts").state).toBe("healthy");

    const oneWildcard = stripeSource({
      read: async () => ({
        apiLivemode: true,
        connectApiReachable: true,
        webhookEndpoints: [endpoint("we_only", ["*"])],
      }),
    });
    const incomplete = await probeCoreSystemHealth(
      dependencies({ stripe: oneWildcard }),
      options,
    );
    expect(state(incomplete, "stripe_payments").state).toBe("healthy");
    expect(state(incomplete, "stripe_payouts")).toMatchObject({
      state: "attention",
      note: "Connect webhook incomplete",
    });
  });

  it("requires the exact enabled webhook URL, event coverage, and two signing secrets", async () => {
    const source = stripeSource({
      signingSecretFingerprints: ["fp_platform"],
      read: async () => ({
        apiLivemode: true,
        connectApiReachable: true,
        webhookEndpoints: [
          endpoint("we_platform", ["payment_intent.succeeded"]),
          endpoint("we_connect", [...STRIPE_CONNECT_WEBHOOK_EVENTS], {
            scope: "connect",
            signingSecretFingerprint: "fp_connect",
            url: `${WEBHOOK_URL}/wrong`,
          }),
        ],
      }),
    });
    const items = await probeCoreSystemHealth(dependencies({ stripe: source }), options);

    expect(state(items, "stripe_payments")).toMatchObject({
      state: "attention",
      note: "Payment webhook incomplete",
    });
    expect(state(items, "stripe_payouts")).toMatchObject({
      state: "attention",
      note: "Connect webhook incomplete",
    });
  });

  it("never reports webhook health green without signing-secret ownership proof", async () => {
    const source = stripeSource({
      read: async () => ({
        apiLivemode: true,
        connectApiReachable: true,
        webhookEndpoints: [
          endpoint("we_platform", [...STRIPE_PLATFORM_WEBHOOK_EVENTS], {
            signingSecretFingerprint: null,
          }),
          endpoint("we_connect", [...STRIPE_CONNECT_WEBHOOK_EVENTS], {
            scope: "connect",
            signingSecretFingerprint: null,
          }),
        ],
      }),
    });
    const items = await probeCoreSystemHealth(dependencies({ stripe: source }), options);

    expect(state(items, "stripe_payments")).toMatchObject({
      state: "attention",
      note: "Payment webhook secret unverified",
    });
    expect(state(items, "stripe_payouts")).toMatchObject({
      state: "attention",
      note: "Connect webhook secret unverified",
    });
  });

  it("does not infer platform or Connect scope from an unmarked endpoint", async () => {
    const source = stripeSource({
      read: async () => ({
        apiLivemode: true,
        connectApiReachable: true,
        webhookEndpoints: [
          endpoint("we_unmarked_platform", ["*"], { scope: null }),
          endpoint("we_unmarked_connect", ["*"], {
            scope: null,
            signingSecretFingerprint: "fp_connect",
          }),
        ],
      }),
    });
    const items = await probeCoreSystemHealth(dependencies({ stripe: source }), options);

    expect(state(items, "stripe_payments")).toMatchObject({
      state: "attention",
      note: "Payment webhook incomplete",
    });
    expect(state(items, "stripe_payouts")).toMatchObject({
      state: "attention",
      note: "Connect webhook incomplete",
    });
  });

  it("refuses test-mode Stripe evidence when production requires live mode", async () => {
    const source = stripeSource({
      read: async () => ({
        apiLivemode: false,
        connectApiReachable: true,
        webhookEndpoints: [
          endpoint("we_platform", ["*"], { livemode: false }),
          endpoint("we_connect", ["*"], {
            scope: "connect",
            signingSecretFingerprint: "fp_connect",
            livemode: false,
          }),
        ],
      }),
    });
    const items = await probeCoreSystemHealth(dependencies({ stripe: source }), options);

    expect(state(items, "stripe_payments")).toMatchObject({
      state: "critical",
      note: "Live mode required",
    });
    expect(state(items, "stripe_payouts").state).toBe("critical");
  });

  it("permits test-mode evidence outside production", async () => {
    const source = stripeSource({
      expectedLivemode: false,
      read: async () => ({
        apiLivemode: false,
        connectApiReachable: true,
        webhookEndpoints: [
          endpoint("we_platform", ["*"], { livemode: false }),
          endpoint("we_connect", ["*"], {
            scope: "connect",
            signingSecretFingerprint: "fp_connect",
            livemode: false,
          }),
        ],
      }),
    });
    const items = await probeCoreSystemHealth(dependencies({ stripe: source }), options);

    expect(state(items, "stripe_payments").state).toBe("healthy");
    expect(state(items, "stripe_payouts").state).toBe("healthy");
  });

  it("keeps payments healthy when only the Connect API is unreachable", async () => {
    const source = stripeSource({
      read: async () => ({
        apiLivemode: true,
        connectApiReachable: false,
        webhookEndpoints: [
          endpoint("we_platform", ["*"]),
          endpoint("we_connect", ["*"], {
            scope: "connect",
            signingSecretFingerprint: "fp_connect",
          }),
        ],
      }),
    });
    const items = await probeCoreSystemHealth(dependencies({ stripe: source }), options);

    expect(state(items, "stripe_payments").state).toBe("healthy");
    expect(state(items, "stripe_payouts")).toMatchObject({
      state: "critical",
      note: "Stripe Connect unavailable",
    });
  });

  it("isolates probe failures and never returns raw provider errors or secrets", async () => {
    const source = stripeSource({
      read: async () => {
        throw new Error("Stripe said sk_live_super_secret request req_private failed");
      },
    });
    const items = await probeCoreSystemHealth(
      dependencies({
        checkDatabase: async () => {
          throw new Error("postgresql://private-database-password");
        },
        stripe: source,
      }),
      options,
    );

    expect(state(items, "database").state).toBe("critical");
    expect(state(items, "auth").state).toBe("healthy");
    expect(state(items, "stripe_payments")).toMatchObject({
      state: "critical",
      note: "Stripe API unavailable",
    });
    expect(state(items, "web_analytics").state).toBe("healthy");
    expect(JSON.stringify(items)).not.toMatch(/super_secret|private-database-password|req_private/);
  });

  it("reports unconfigured Stripe without attempting an API call", async () => {
    const read = vi.fn(async () => ({
      apiLivemode: true,
      connectApiReachable: true,
      webhookEndpoints: [],
    }));
    const items = await probeCoreSystemHealth(
      dependencies({
        stripe: stripeSource({ configured: false, read }),
      }),
      options,
    );

    expect(read).not.toHaveBeenCalled();
    expect(state(items, "stripe_payments")).toMatchObject({
      state: "unknown",
      note: "Not configured",
      checkedAt: "2026-09-14T12:00:00.000Z",
    });
    expect(state(items, "stripe_payouts").state).toBe("unknown");
  });

  it("keeps no-traffic and stale analytics unknown", async () => {
    const noEvents = await probeCoreSystemHealth(
      dependencies({ readAnalyticsEvidence: async () => ({ lastEventAt: null }) }),
      options,
    );
    expect(state(noEvents, "web_analytics")).toMatchObject({
      state: "unknown",
      note: "Waiting for first event",
    });

    const stale = await probeCoreSystemHealth(
      dependencies({
        readAnalyticsEvidence: async () => ({
          lastEventAt: new Date(NOW - 25 * 60 * 60 * 1_000).toISOString(),
        }),
      }),
      options,
    );
    expect(state(stale, "web_analytics")).toMatchObject({
      state: "unknown",
      note: "No event in the last 24 hours",
      lastSeenAt: new Date(NOW - 25 * 60 * 60 * 1_000).toISOString(),
    });

    const unavailable = await probeCoreSystemHealth(
      dependencies({
        readAnalyticsEvidence: async () => {
          throw new Error("raw analytics backend details");
        },
      }),
      options,
    );
    expect(state(unavailable, "web_analytics")).toMatchObject({
      state: "critical",
      note: "Analytics probe failed",
    });
  });

  it("does not accept a future analytics timestamp as healthy", async () => {
    const items = await probeCoreSystemHealth(
      dependencies({
        readAnalyticsEvidence: async () => ({
          lastEventAt: new Date(NOW + 10 * 60 * 1_000).toISOString(),
        }),
      }),
      options,
    );

    expect(state(items, "web_analytics")).toMatchObject({
      state: "attention",
      note: "Analytics timestamp is in the future",
    });
  });

  it("times out a stuck probe without blocking the independent results", async () => {
    const items = await probeCoreSystemHealth(
      dependencies({
        checkDatabase: () => new Promise<void>(() => undefined),
      }),
      { ...options, timeoutMs: 5 },
    );

    expect(state(items, "database").state).toBe("critical");
    expect(state(items, "auth").state).toBe("healthy");
    expect(state(items, "web_analytics").state).toBe("healthy");
  });

  it("single-flights concurrent Stripe probes and serves the short module cache", async () => {
    let resolveRead!: (value: {
      apiLivemode: boolean;
      connectApiReachable: boolean;
      webhookEndpoints: StripeWebhookEvidence[];
    }) => void;
    const read = vi.fn(
      () => new Promise<{
        apiLivemode: boolean;
        connectApiReachable: boolean;
        webhookEndpoints: StripeWebhookEvidence[];
      }>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const source = stripeSource({ read });
    const deps = dependencies({ stripe: source });

    const first = probeCoreSystemHealth(deps, options);
    const second = probeCoreSystemHealth(deps, options);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    resolveRead({
      apiLivemode: true,
      connectApiReachable: true,
      webhookEndpoints: [
        endpoint("we_platform", ["*"]),
        endpoint("we_connect", ["*"], {
          scope: "connect",
          signingSecretFingerprint: "fp_connect",
        }),
      ],
    });

    await Promise.all([first, second]);
    await probeCoreSystemHealth(deps, options);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
