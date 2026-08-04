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

const existing = await stripe("webhook_endpoints?limit=100");
const secrets = [];

for (const endpoint of ENDPOINTS) {
  const already = existing.data.find(
    (e) => e.url === url && Boolean(e.connect) === endpoint.connect,
  );

  if (already) {
    console.log(`· ${endpoint.label}: already registered as ${already.id} — left alone.`);
    console.log("  Its signing secret was only shown when it was created.");
    continue;
  }

  const created = await stripe("webhook_endpoints", {
    method: "POST",
    params: [
      ["url", url],
      ["description", `Minimum Stress Spaces — ${endpoint.label}`],
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
