/**
 * The first-party analytics event vocabulary, and the guard that keeps sensitive
 * data out of it.
 *
 * Pure and dependency-free so both the server emitter and the tests share one
 * definition of "a valid event". The taxonomy is a fixed allow-list — an unknown
 * event name is refused rather than silently stored, so the Growth dashboard can
 * trust that a name means what it says. Anything that is a business FACT
 * (payments, subscriptions, bookings) is emitted server-side from the source of
 * truth; the client is never trusted for money or state.
 */

/** The complete event vocabulary. Add a name here before emitting it. */
export const ANALYTICS_EVENTS = [
  "app_opened",
  "page_viewed",
  "signup_started",
  "signup_completed",
  "account_type_selected",
  "space_search",
  "search_no_results",
  "space_viewed",
  "location_changed",
  "booking_started",
  "checkout_started",
  "payment_succeeded",
  "booking_confirmed",
  "booking_cancelled",
  "practitioner_pro_checkout_started",
  "practitioner_pro_started",
  "practitioner_pro_cancelled",
  "studio_pro_checkout_started",
  "studio_pro_started",
  "studio_pro_cancelled",
  "work_viewed",
  "work_posted",
  "work_applied",
  "work_confirmed",
  "auth_failed",
  "notification_failed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

const EVENT_SET = new Set<string>(ANALYTICS_EVENTS);

export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return EVENT_SET.has(name);
}

/**
 * Which events are server-derived business facts. The client may never assert
 * these — a client `payment_succeeded` would let anyone fake revenue — so the
 * ingestion route rejects them and only server emitters (webhooks, capture,
 * confirm) may write them.
 */
export const SERVER_ONLY_EVENTS = new Set<AnalyticsEventName>([
  "signup_completed",
  "payment_succeeded",
  "booking_confirmed",
  "booking_cancelled",
  "practitioner_pro_started",
  "practitioner_pro_cancelled",
  "studio_pro_started",
  "studio_pro_cancelled",
  "work_confirmed",
  "notification_failed",
]);

/**
 * Keys we refuse to store, matched case-insensitively as substrings. The event
 * stream is for shapes and counts, never for secrets, message contents, medical
 * information, addresses, or payment credentials.
 */
const FORBIDDEN_KEY_PATTERNS = [
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "card",
  "cvc",
  "cvv",
  "pan",
  "ssn",
  "medical",
  "diagnosis",
  "health",
  "message",
  "body",
  "content",
  "address",
  "phone",
  "email",
] as const;

const MAX_PROPERTIES = 30;
const MAX_STRING_LENGTH = 500;

function keyIsForbidden(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Strip a properties bag down to something safe to persist: drop forbidden keys,
 * keep only JSON scalars (string/number/boolean/null), truncate long strings, and
 * cap the number of keys. Never throws — a bad bag yields an empty one rather
 * than blocking the emit.
 */
export function sanitizeProperties(input: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_PROPERTIES) break;
    if (keyIsForbidden(key)) continue;
    if (value === null) {
      out[key] = null;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
    } else {
      // Objects/arrays/functions/undefined are dropped — the bag is scalar-only.
      continue;
    }
    count += 1;
  }
  return out;
}

export interface AnalyticsEventInput {
  name: string;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  surface?: string | null;
  properties?: unknown;
}

export type ValidatedEvent =
  | { ok: true; value: {
      name: AnalyticsEventName;
      userId: string | null;
      anonymousId: string | null;
      sessionId: string | null;
      platform: string | null;
      appVersion: string | null;
      surface: string | null;
      properties: Record<string, string | number | boolean | null>;
    } }
  | { ok: false; reason: string };

const cap = (v: string | null | undefined, max = 200): string | null =>
  v == null ? null : v.slice(0, max);

/**
 * Validate + sanitize one event. `allowServerOnly` gates the business-fact events
 * so the public ingestion route can pass `false` and only trusted server emitters
 * pass `true`.
 */
export function validateEvent(input: AnalyticsEventInput, allowServerOnly = false): ValidatedEvent {
  if (typeof input.name !== "string" || !isAnalyticsEvent(input.name)) {
    return { ok: false, reason: "unknown event name" };
  }
  if (!allowServerOnly && SERVER_ONLY_EVENTS.has(input.name)) {
    return { ok: false, reason: "that event is server-derived and cannot be reported by a client" };
  }
  return {
    ok: true,
    value: {
      name: input.name,
      userId: input.userId ?? null,
      anonymousId: cap(input.anonymousId),
      sessionId: cap(input.sessionId),
      platform: cap(input.platform, 40),
      appVersion: cap(input.appVersion, 40),
      surface: cap(input.surface, 120),
      properties: sanitizeProperties(input.properties),
    },
  };
}
