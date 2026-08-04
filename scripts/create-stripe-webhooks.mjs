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
    connect: false,
    events: ["payment_intent.succeeded", "payment_intent.canceled", "charge.refunded"],
  },
  {
    label: "hosts (connected accounts)",
    connect: true,
    events: ["account.updated", "payout.failed"],
  },
];

/**
 * Which of the two an existing endpoint is.
 *
 * Not `connect` — that field is accepted when creating an endpoint but is
 * absent from the one the API returns, so reading it back gives `undefined`
 * for both kinds. Matching on it made every endpoint look like the platform
 * one: the script "found" the Connect endpoint, relabelled it, and then
 * created a second Connect endpoint because it had not found that one. Three
 * endpoints, two of them wrong, and a duplicate quietly failing signature
 * checks against a secret nobody had stored.
 *
 * `application` is the field that actually distinguishes them: a Connect
 * endpoint carries the connect application id, a platform endpoint has null.
 */
const isConnect = (endpoint) => endpoint.application !== null;

const existing = await stripe("webhook_endpoints?limit=100");
const secrets = [];

for (const endpoint of ENDPOINTS) {
  const already = existing.data.find(
    (e) => e.url === url && isConnect(e) === endpoint.connect,
  );

  const description = `Minimum Stress — ${endpoint.label}`;

  if (already) {
    console.log(`· ${endpoint.label}: already registered as ${already.id}.`);
    console.log("  Its signing secret was only shown when it was created.");

    // The label is the only thing worth correcting on an existing endpoint:
    // the URL and events define what it does, but the description is what a
    // person reads in the dashboard, so a stale one is quietly misleading.
    if (already.description !== description) {
      await stripe(`webhook_endpoints/${already.id}`, {
        method: "POST",
        params: [["description", description]],
      });
      console.log(`  Description updated to "${description}".`);
    }
    continue;
  }

  const created = await stripe("webhook_endpoints", {
    method: "POST",
    params: [
      ["url", url],
      ["description", description],
      ...(endpoint.connect ? [["connect", "true"]] : []),
      ...endpoint.events.map((event) => ["enabled_events[]", event]),
    ],
  });

  console.log(`✓ ${endpoint.label}: ${created.id}`);
  console.log(`  ${created.enabled_events.join(", ")}`);
  secrets.push(created.secret);
}

if (secrets.length === ENDPOINTS.length) {
  console.log("\nSet STRIPE_WEBHOOK_SECRET to exactly this one line:\n");
  console.log(secrets.join(","));
} else if (secrets.length > 0) {
  console.log("\nNew secret(s), to combine with the one(s) you already have:\n");
  console.log(secrets.join(","));
}
