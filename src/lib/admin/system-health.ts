import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { HealthItem } from "./command";
import { siteUrl } from "../site-url";
import { stripe } from "../stripe/client";

export const STRIPE_PLATFORM_WEBHOOK_EVENTS = [
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.deleted",
  "customer.subscription.updated",
  "identity.verification_session.verified",
  "payment_intent.amount_capturable_updated",
  "payment_intent.canceled",
  "payment_intent.succeeded",
] as const;

export const STRIPE_CONNECT_WEBHOOK_EVENTS = [
  "account.updated",
  "payout.failed",
] as const;

const DEFAULT_PROBE_TIMEOUT_MS = 3_500;
const STRIPE_REQUEST_TIMEOUT_MS = 3_000;
const DEFAULT_STRIPE_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_STRIPE_FAILURE_CACHE_TTL_MS = 15_000;
const DEFAULT_ANALYTICS_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
const ANALYTICS_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const PRODUCTION_STRIPE_CACHE_KEY = {};

export const STRIPE_WEBHOOK_SCOPE_METADATA_KEY = "minimumstress_scope";
export const STRIPE_WEBHOOK_SECRET_FINGERPRINT_METADATA_KEY =
  "minimumstress_signing_secret_sha256";
export const STRIPE_PLATFORM_WEBHOOK_DESCRIPTION =
  "Minimum Stress — payments (platform account)";
export const STRIPE_CONNECT_WEBHOOK_DESCRIPTION =
  "Minimum Stress — hosts (connected accounts)";

export type StripeWebhookScope = "platform" | "connect";

/**
 * A health item whose evidence is tied to a particular observation.
 *
 * This extends the existing Command Center contract instead of creating a
 * parallel status vocabulary. `checkedAt` and `latencyMs` let the UI say when
 * the evidence was gathered rather than presenting an undated green light.
 */
export interface CheckedHealthItem extends HealthItem {
  checkedAt: string;
  latencyMs: number;
  lastSeenAt?: string;
}

export interface AnalyticsEvidence {
  /** Latest app-open or page-view accepted by the first-party collector. */
  lastEventAt: string | null;
}

export interface StripeWebhookEvidence {
  id: string;
  enabledEvents: string[];
  livemode: boolean;
  scope: StripeWebhookScope | null;
  signingSecretFingerprint: string | null;
  status: string;
  url: string;
}

export interface StripeEvidence {
  apiLivemode: boolean;
  connectApiReachable: boolean;
  webhookEndpoints: StripeWebhookEvidence[];
}

export interface StripeHealthSource {
  /** Stable identity for the module cache; never use a secret as this key. */
  cacheKey: object;
  configured: boolean;
  expectedLivemode: boolean;
  expectedWebhookUrl: string;
  signingSecretFingerprints: string[];
  read: () => Promise<StripeEvidence>;
}

/**
 * The effectful edges of the health check. Keeping these small makes every
 * provider independently testable and prevents one outage from hiding all the
 * other statuses.
 */
export interface CoreSystemHealthDependencies {
  checkDatabase: () => Promise<void>;
  checkAuth: () => Promise<void>;
  readAnalyticsEvidence: () => Promise<AnalyticsEvidence>;
  stripe: StripeHealthSource | null;
}

export interface CoreSystemHealthOptions {
  analyticsFreshnessMs?: number;
  now?: () => number;
  stripeFailureCacheTtlMs?: number;
  stripeCacheTtlMs?: number;
  timeoutMs?: number;
}

interface TimedSuccess<T> {
  ok: true;
  value: T;
  checkedAt: string;
  latencyMs: number;
}

interface TimedFailure {
  ok: false;
  checkedAt: string;
  latencyMs: number;
}

type TimedResult<T> = TimedSuccess<T> | TimedFailure;

interface StripeCacheEntry {
  expiresAt: number;
  result?: TimedResult<StripeEvidence>;
  inFlight?: Promise<TimedResult<StripeEvidence>>;
}

const stripeCache = new WeakMap<object, StripeCacheEntry>();
const TIMEOUT = Symbol("health-probe-timeout");

/**
 * Production wiring. The Supabase secret/service-role client stays on the
 * server; only the small, non-sensitive result objects leave this module.
 */
export function productionSystemHealthDependencies(
  admin: SupabaseClient,
): CoreSystemHealthDependencies {
  return {
    checkDatabase: async () => {
      const { error } = await admin.from("profiles").select("id").limit(1);
      if (error) throw new Error("database probe failed");
    },
    checkAuth: async () => {
      const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) throw new Error("auth probe failed");
    },
    readAnalyticsEvidence: async () => {
      const { data, error } = await admin
        .from("analytics_events")
        .select("occurred_at")
        .in("event_name", ["app_opened", "page_viewed"])
        .order("occurred_at", { ascending: false })
        .limit(1);
      if (error) throw new Error("analytics probe failed");

      const rows = data as Array<{ occurred_at: string | null }> | null;
      return { lastEventAt: rows?.[0]?.occurred_at ?? null };
    },
    stripe: productionStripeSource(),
  };
}

/** Run all probes concurrently; each one is isolated and has its own timeout. */
export async function probeCoreSystemHealth(
  dependencies: CoreSystemHealthDependencies,
  options: CoreSystemHealthOptions = {},
): Promise<CheckedHealthItem[]> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const stripeCacheTtlMs =
    options.stripeCacheTtlMs ?? DEFAULT_STRIPE_CACHE_TTL_MS;
  const stripeFailureCacheTtlMs =
    options.stripeFailureCacheTtlMs ?? DEFAULT_STRIPE_FAILURE_CACHE_TTL_MS;
  const analyticsFreshnessMs =
    options.analyticsFreshnessMs ?? DEFAULT_ANALYTICS_FRESHNESS_MS;

  const [database, auth, analytics, stripeResult] = await Promise.all([
    observe(dependencies.checkDatabase, timeoutMs, now),
    observe(dependencies.checkAuth, timeoutMs, now),
    observe(dependencies.readAnalyticsEvidence, timeoutMs, now),
    observeStripe(
      dependencies.stripe,
      timeoutMs,
      stripeCacheTtlMs,
      stripeFailureCacheTtlMs,
      now,
    ),
  ]);

  return [
    basicHealth("database", "Database", database, "Database probe failed"),
    basicHealth("auth", "Auth", auth, "Auth probe failed"),
    ...stripeHealth(dependencies.stripe, stripeResult, new Date(now()).toISOString()),
    analyticsHealth(analytics, now(), analyticsFreshnessMs),
  ];
}

function productionStripeSource(): StripeHealthSource {
  const configured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const signingSecretFingerprints = (process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean)
    .map(signingSecretFingerprint);

  return {
    cacheKey: PRODUCTION_STRIPE_CACHE_KEY,
    configured,
    expectedLivemode:
      process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production",
    expectedWebhookUrl: `${siteUrl()}/api/stripe/webhook`,
    signingSecretFingerprints: [...new Set(signingSecretFingerprints)],
    read: async () => {
      const client = stripe();
      const requestOptions = {
        maxNetworkRetries: 0,
        timeout: STRIPE_REQUEST_TIMEOUT_MS,
      };
      const [balance, endpoints, connectApiReachable] = await Promise.all([
        client.balance.retrieve({}, requestOptions),
        client.webhookEndpoints.list({ limit: 100 }, requestOptions),
        client.accounts
          .list({ limit: 1 }, requestOptions)
          .then(() => true, () => false),
      ]);

      return {
        apiLivemode: balance.livemode,
        connectApiReachable,
        webhookEndpoints: endpoints.data.map((endpoint) => ({
          id: endpoint.id,
          enabledEvents: [...endpoint.enabled_events],
          livemode: endpoint.livemode,
          // Scope is ours to declare. Do not infer it from Stripe's
          // `application` field: Stripe documents that as an associated
          // Connect application, not as a read-back of the create-time
          // `connect` flag. Exact legacy descriptions are accepted only to
          // diagnose coverage as unverified; the setup script refuses to mark
          // a legacy endpoint until a person verifies its scope in Stripe.
          scope: webhookScope(endpoint.description, endpoint.metadata),
          signingSecretFingerprint:
            endpoint.metadata[
              STRIPE_WEBHOOK_SECRET_FINGERPRINT_METADATA_KEY
            ] ?? null,
          status: endpoint.status,
          url: endpoint.url,
        })),
      };
    },
  };
}

async function observeStripe(
  source: StripeHealthSource | null,
  timeoutMs: number,
  cacheTtlMs: number,
  failureCacheTtlMs: number,
  now: () => number,
): Promise<TimedResult<StripeEvidence> | null> {
  if (!source?.configured) return null;

  const current = now();
  const cached = stripeCache.get(source.cacheKey);
  if (cached?.result && cached.expiresAt > current) return cached.result;
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = observe(source.read, timeoutMs, now).then((result) => {
    stripeCache.set(source.cacheKey, {
      expiresAt:
        now() + Math.max(0, result.ok ? cacheTtlMs : failureCacheTtlMs),
      result,
    });
    return result;
  });
  stripeCache.set(source.cacheKey, { expiresAt: 0, inFlight });

  try {
    return await inFlight;
  } catch {
    // `observe` resolves failures, but keep this boundary fail-closed if it is
    // ever refactored. No provider error (which may contain request details) is
    // returned or logged.
    const checkedAt = new Date(now()).toISOString();
    const result: TimedFailure = { ok: false, checkedAt, latencyMs: 0 };
    stripeCache.set(source.cacheKey, {
      expiresAt: now() + Math.max(0, failureCacheTtlMs),
      result,
    });
    return result;
  }
}

async function observe<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  now: () => number,
): Promise<TimedResult<T>> {
  const startedAt = now();
  try {
    const value = await withTimeout(operation(), timeoutMs);
    const finishedAt = now();
    return {
      ok: true,
      value,
      checkedAt: new Date(finishedAt).toISOString(),
      latencyMs: Math.max(0, finishedAt - startedAt),
    };
  } catch {
    const finishedAt = now();
    return {
      ok: false,
      checkedAt: new Date(finishedAt).toISOString(),
      latencyMs: Math.max(0, finishedAt - startedAt),
    };
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(TIMEOUT), Math.max(1, timeoutMs));
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function basicHealth<T>(
  key: string,
  label: string,
  result: TimedResult<T>,
  failureNote: string,
): CheckedHealthItem {
  return {
    key,
    label,
    state: result.ok ? "healthy" : "critical",
    note: result.ok ? undefined : failureNote,
    checkedAt: result.checkedAt,
    latencyMs: result.latencyMs,
  };
}

function stripeHealth(
  source: StripeHealthSource | null,
  result: TimedResult<StripeEvidence> | null,
  fallbackCheckedAt: string,
): [CheckedHealthItem, CheckedHealthItem] {
  if (!source?.configured || !result) {
    return [
      {
        key: "stripe_payments",
        label: "Stripe payments",
        state: "unknown",
        note: "Not configured",
        checkedAt: fallbackCheckedAt,
        latencyMs: 0,
      },
      {
        key: "stripe_payouts",
        label: "Stripe Connect payouts",
        state: "unknown",
        note: "Not configured",
        checkedAt: fallbackCheckedAt,
        latencyMs: 0,
      },
    ];
  }

  const common = {
    checkedAt: result.checkedAt,
    latencyMs: result.latencyMs,
  };
  if (!result.ok) {
    return [
      {
        key: "stripe_payments",
        label: "Stripe payments",
        state: "critical",
        note: "Stripe API unavailable",
        ...common,
      },
      {
        key: "stripe_payouts",
        label: "Stripe Connect payouts",
        state: "critical",
        note: "Stripe API unavailable",
        ...common,
      },
    ];
  }

  if (source.expectedLivemode && !result.value.apiLivemode) {
    return [
      {
        key: "stripe_payments",
        label: "Stripe payments",
        state: "critical",
        note: "Live mode required",
        ...common,
      },
      {
        key: "stripe_payouts",
        label: "Stripe Connect payouts",
        state: "critical",
        note: "Live mode required",
        ...common,
      },
    ];
  }

  const coverage = webhookCoverage(
    result.value.webhookEndpoints,
    source.expectedWebhookUrl,
    source.expectedLivemode,
  );
  const configuredFingerprints = new Set(source.signingSecretFingerprints);
  const platformFingerprint = coverage.platform?.signingSecretFingerprint ?? null;
  const connectFingerprint = coverage.connect?.signingSecretFingerprint ?? null;
  const paymentsReady = Boolean(
    platformFingerprint && configuredFingerprints.has(platformFingerprint),
  );
  const connectReady = Boolean(
    connectFingerprint &&
      configuredFingerprints.has(connectFingerprint) &&
      configuredFingerprints.size >= 2 &&
      platformFingerprint !== connectFingerprint,
  );

  const paymentsNote = !coverage.platform
    ? "Payment webhook incomplete"
    : paymentsReady
      ? "API and webhook verified"
      : "Payment webhook secret unverified";
  const connectNote = !coverage.connect
    ? "Connect webhook incomplete"
    : connectReady
      ? "Connect API and webhook verified"
      : "Connect webhook secret unverified";

  return [
    {
      key: "stripe_payments",
      label: "Stripe payments",
      state: paymentsReady ? "healthy" : "attention",
      note: paymentsNote,
      ...common,
    },
    {
      key: "stripe_payouts",
      label: "Stripe Connect payouts",
      state: !result.value.connectApiReachable
        ? "critical"
        : connectReady
          ? "healthy"
          : "attention",
      note: !result.value.connectApiReachable
        ? "Stripe Connect unavailable"
        : connectNote,
      ...common,
    },
  ];
}

/**
 * A wildcard covers the event list, but it does not change an endpoint's
 * explicitly marked scope. Returning the matching endpoint (rather than just
 * a boolean) also lets the caller prove that the deployed signing secret is
 * the one Stripe returned when that endpoint was created.
 */
function webhookCoverage(
  endpoints: StripeWebhookEvidence[],
  expectedUrl: string,
  requireLivemode: boolean,
): {
  platform: StripeWebhookEvidence | null;
  connect: StripeWebhookEvidence | null;
} {
  const eligible = endpoints.filter((endpoint) =>
      endpoint.status === "enabled" &&
      endpoint.url === expectedUrl &&
      (!requireLivemode || endpoint.livemode),
    );
  const platform = eligible.find((endpoint) =>
    endpoint.scope === "platform" &&
    covers(endpoint.enabledEvents, STRIPE_PLATFORM_WEBHOOK_EVENTS),
  ) ?? null;
  const connect = eligible.find((endpoint) =>
    endpoint.scope === "connect" &&
    covers(endpoint.enabledEvents, STRIPE_CONNECT_WEBHOOK_EVENTS),
  ) ?? null;

  return { platform, connect };
}

function webhookScope(
  description: string | null,
  metadata: Record<string, string>,
): StripeWebhookScope | null {
  const marker = metadata[STRIPE_WEBHOOK_SCOPE_METADATA_KEY];
  if (marker === "platform" || marker === "connect") return marker;
  if (description === STRIPE_PLATFORM_WEBHOOK_DESCRIPTION) return "platform";
  if (description === STRIPE_CONNECT_WEBHOOK_DESCRIPTION) return "connect";
  return null;
}

function signingSecretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function covers(enabled: string[], required: readonly string[]): boolean {
  return enabled.includes("*") || required.every((event) => enabled.includes(event));
}

function analyticsHealth(
  result: TimedResult<AnalyticsEvidence>,
  nowMs: number,
  freshnessMs: number,
): CheckedHealthItem {
  const common = {
    key: "web_analytics",
    label: "Web analytics",
    checkedAt: result.checkedAt,
    latencyMs: result.latencyMs,
  };
  if (!result.ok) {
    return {
      ...common,
      state: "critical",
      note: "Analytics probe failed",
    };
  }

  if (!result.value.lastEventAt) {
    return {
      ...common,
      state: "unknown",
      note: "Waiting for first event",
    };
  }

  const lastEventMs = Date.parse(result.value.lastEventAt);
  if (!Number.isFinite(lastEventMs)) {
    return {
      ...common,
      state: "attention",
      note: "Analytics evidence invalid",
    };
  }

  if (lastEventMs > nowMs + ANALYTICS_CLOCK_SKEW_MS) {
    return {
      ...common,
      state: "attention",
      note: "Analytics timestamp is in the future",
      lastSeenAt: result.value.lastEventAt,
    };
  }

  if (nowMs - lastEventMs > Math.max(0, freshnessMs)) {
    const freshnessHours = Math.max(1, Math.round(freshnessMs / (60 * 60 * 1_000)));
    return {
      ...common,
      state: "unknown",
      note: `No event in the last ${freshnessHours} hours`,
      lastSeenAt: result.value.lastEventAt,
    };
  }

  return {
    ...common,
    state: "healthy",
    note: "Events received",
    lastSeenAt: result.value.lastEventAt,
  };
}
