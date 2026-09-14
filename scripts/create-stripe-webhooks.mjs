import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Registers the two webhook endpoints this app needs, and prints the signing
 * secrets to paste into STRIPE_WEBHOOK_SECRET.
 *
 * Two, not one, and that is the entire reason this script exists rather than
 * being a line in the README. `payment_intent.*` happen on the platform
 * account because we create the charges. `account.updated` and `payout.failed`
 * happen on the *connected* account, and an endpoint only receives those if it
 * was created with Connect enabled — which Stripe treats as a different
 * endpoint with its own secret, even pointing at the same URL.
 *
 * Getting this wrong is quiet rather than loud: account.updated is the only
 * thing that ever marks a host payable, so hosts would finish Stripe
 * onboarding and simply never become bookable.
 *
 *   node scripts/create-stripe-webhooks.mjs https://your-app.vercel.app
 *
 * Safe to re-run: existing endpoints for the same URL are reported and left
 * alone rather than duplicated. Stripe only reveals a signing secret when the
 * endpoint is created, so if you lose one, roll it in the dashboard.
 */

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/create-stripe-webhooks.mjs https://your-app.vercel.app");
  process.exit(1);
}

const url = new URL("/api/stripe/webhook", base).toString();

const SCOPE_METADATA_KEY = "minimumstress_scope";
const SECRET_FINGERPRINT_METADATA_KEY =
  "minimumstress_signing_secret_sha256";

const key = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("STRIPE_SECRET_KEY="))
  ?.slice("STRIPE_SECRET_KEY=".length)
  .trim();

if (!key) {
  console.error("STRIPE_SECRET_KEY not found in .env.local");
  process.exit(1);
}

async function stripe(path, { method = "GET", params } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of params ?? []) body.append(k, v);

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(params ? { body } : {}),
  });

  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

const ENDPOINTS = [
  {
    label: "payments (platform account)",
    scope: "platform",
    connect: false,
    events: [
      "payment_intent.succeeded",
      "payment_intent.amount_capturable_updated",
      "payment_intent.canceled",
      "charge.refunded",
      "identity.verification_session.verified",
      // Subscriptions live on the platform account, not the connected one.
      // These are the only thing that ever marks somebody Pro.
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ],
  },
  {
    label: "hosts (connected accounts)",
    scope: "connect",
    connect: true,
    events: ["account.updated", "payout.failed"],
  },
];

const descriptionFor = (endpoint) => `Minimum Stress — ${endpoint.label}`;
const markedScopeOf = (endpoint) => {
  const marker = endpoint.metadata?.[SCOPE_METADATA_KEY];
  if (marker === "platform" || marker === "connect") return marker;
  return null;
};
const fingerprint = (secret) =>
  createHash("sha256").update(secret).digest("hex");

const existing = await stripe("webhook_endpoints?limit=100");
const secrets = [];

// An endpoint at our URL without one of our exact scope markers is not safe to
// guess about. Creating around it can cause duplicate deliveries, while
// relabelling it could claim somebody else's endpoint. Stop and make the
// ambiguity visible instead.
const ambiguous = existing.data.filter(
  (endpoint) => endpoint.url === url && markedScopeOf(endpoint) === null,
);
if (ambiguous.length > 0) {
  console.error(
    `Refusing to guess the scope of ${ambiguous.length} endpoint(s) at ${url}: ${ambiguous
      .map((endpoint) => endpoint.id)
      .join(", ")}`,
  );
  console.error(
    `Verify each endpoint's platform/Connect scope in Stripe, then add metadata ${SCOPE_METADATA_KEY}=platform or ${SCOPE_METADATA_KEY}=connect. Alternatively remove the legacy endpoints and let this script recreate them.`,
  );
  process.exit(1);
}

for (const endpoint of ENDPOINTS) {
  const matches = existing.data.filter(
    (candidate) =>
      candidate.url === url && markedScopeOf(candidate) === endpoint.scope,
  );
  if (matches.length > 1) {
    console.error(
      `Refusing to modify duplicate ${endpoint.scope} endpoints at ${url}: ${matches
        .map((candidate) => candidate.id)
        .join(", ")}`,
    );
    process.exit(1);
  }
  const already = matches[0];

  const description = descriptionFor(endpoint);

  if (already) {
    console.log(`· ${endpoint.label}: already registered as ${already.id}.`);
    console.log("  Its signing secret was only shown when it was created.");

    // The label is the only thing worth correcting on an existing endpoint:
    // the URL and events define what it does, but the description is what a
    // person reads in the dashboard, so a stale one is quietly misleading.
    if (
      already.description !== description ||
      already.metadata?.[SCOPE_METADATA_KEY] !== endpoint.scope
    ) {
      await stripe(`webhook_endpoints/${already.id}`, {
        method: "POST",
        params: [
          ["description", description],
          [`metadata[${SCOPE_METADATA_KEY}]`, endpoint.scope],
        ],
      });
      console.log(`  Description and scope marker synced.`);
    }

    if (!already.metadata?.[SECRET_FINGERPRINT_METADATA_KEY]) {
      console.log(
        "  Signing-secret ownership is unverified; rotate/recreate this endpoint to establish proof.",
      );
    }

    /**
     * The event list is synced, not just reported.
     *
     * Handling a new event in code does nothing until Stripe is told to send
     * it, and there is no error when it is missed — the handler simply never
     * runs. That is how subscription support shipped complete and unable to
     * make anybody Pro.
     */
    const registered = new Set(already.enabled_events ?? []);
    const missing = endpoint.events.filter((event) => !registered.has(event));

    if (missing.length > 0) {
      await stripe(`webhook_endpoints/${already.id}`, {
        method: "POST",
        params: endpoint.events.map((event) => ["enabled_events[]", event]),
      });
      console.log(`  Added: ${missing.join(", ")}`);
    }

    continue;
  }

  const created = await stripe("webhook_endpoints", {
    method: "POST",
    params: [
      ["url", url],
      ["description", description],
      [`metadata[${SCOPE_METADATA_KEY}]`, endpoint.scope],
      ...(endpoint.connect ? [["connect", "true"]] : []),
      ...endpoint.events.map((event) => ["enabled_events[]", event]),
    ],
  });

  console.log(`✓ ${endpoint.label}: ${created.id}`);
  console.log(`  ${created.enabled_events.join(", ")}`);
  secrets.push(created.secret);

  // Stripe reveals this secret once. Persist only its one-way fingerprint on
  // the endpoint so runtime health can prove the configured secret belongs to
  // a real, enabled endpoint without ever reading or exposing the secret.
  try {
    await stripe(`webhook_endpoints/${created.id}`, {
      method: "POST",
      params: [
        [
          `metadata[${SECRET_FINGERPRINT_METADATA_KEY}]`,
          fingerprint(created.secret),
        ],
      ],
    });
    console.log("  Signing-secret proof recorded.");
  } catch (error) {
    // Do not lose the once-visible secret because a metadata write failed.
    // It remains in `secrets` and is printed below for recovery.
    console.error(
      `  Could not record signing-secret proof for ${created.id}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

if (secrets.length === ENDPOINTS.length) {
  console.log("\nSet STRIPE_WEBHOOK_SECRET to exactly this one line:\n");
  console.log(secrets.join(","));
} else if (secrets.length > 0) {
  console.log("\nNew secret(s), to combine with the one(s) you already have:\n");
  console.log(secrets.join(","));
}
