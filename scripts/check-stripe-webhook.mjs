import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Proves the deployed webhook endpoint actually works, end to end.
 *
 * Signs a payload with each configured secret and posts it at the real URL.
 * A 200 means four separate things are true at once: the deployment is
 * reachable, STRIPE_WEBHOOK_SECRET is set in that environment, it holds the
 * right value, and every secret in the list verifies — which is the part a
 * unit test cannot check, because the value only exists in Vercel.
 *
 * Then it sends a deliberately mis-signed payload, because an endpoint that
 * returns 200 for everything would pass the test above just as happily.
 *
 *   node scripts/check-stripe-webhook.mjs https://your-app.vercel.app
 *
 * The events are inert by design: account.updated for an account id that
 * exists nowhere, so the handler runs its real path and updates no rows.
 */

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/check-stripe-webhook.mjs https://your-app.vercel.app");
  process.exit(1);
}

const url = new URL("/api/stripe/webhook", base).toString();

const secrets = (
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("STRIPE_WEBHOOK_SECRET="))
    ?.slice("STRIPE_WEBHOOK_SECRET=".length)
    .trim() ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (secrets.length === 0) {
  console.error("STRIPE_WEBHOOK_SECRET not found in .env.local");
  process.exit(1);
}

/** Stripe's scheme: HMAC-SHA256 over `timestamp.payload`, keyed by the secret. */
function sign(payload, secret, timestamp) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

async function send(payload, signature) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  return { status: response.status, body: (await response.text()).slice(0, 120) };
}

const event = (id) =>
  JSON.stringify({
    id,
    object: "event",
    type: "account.updated",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: "acct_endpoint_check_no_such_account",
        object: "account",
        charges_enabled: false,
        payouts_enabled: false,
      },
    },
  });

console.log(`POST ${url}\n`);

let allGood = true;

for (const [index, secret] of secrets.entries()) {
  const payload = event(`evt_check_${index}`);
  const timestamp = Math.floor(Date.now() / 1000);
  const { status, body } = await send(payload, sign(payload, secret, timestamp));

  const ok = status === 200;
  allGood &&= ok;
  console.log(`${ok ? "✓" : "✗"} secret ${index + 1} of ${secrets.length} → ${status} ${body}`);
}

// The control. Without this, an endpoint that ignored signatures entirely
// would look identical to one that checks them.
const payload = event("evt_check_forged");
const timestamp = Math.floor(Date.now() / 1000);
const forged = await send(payload, sign(payload, "whsec_this_is_not_one_of_ours", timestamp));

const rejected = forged.status === 400;
allGood &&= rejected;
console.log(`${rejected ? "✓" : "✗"} forged signature → ${forged.status} ${forged.body}`);

console.log(
  allGood
    ? "\nEndpoint is live, accepts every configured secret, and rejects anything else."
    : "\nSomething is wrong — see the lines marked ✗ above.",
);
process.exit(allGood ? 0 : 1);
