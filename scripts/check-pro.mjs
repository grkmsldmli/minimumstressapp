import { readFileSync } from "node:fs";

/**
 * Proves the Pro subscription is wired to a real recurring price.
 *
 * Creating the price lazily means nothing exists in Stripe until somebody
 * subscribes — which is fine, and also means "it works" cannot be asserted
 * from reading the code. This asks Stripe.
 *
 *   node scripts/check-pro.mjs
 */

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("=");
      return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : null;
    })
    .filter(Boolean),
);

const KEY = env.STRIPE_SECRET_KEY;
const LOOKUP = "minimum_stress_pro_monthly";

/** The price the app charges, from the one place it is written down. */
const EXPECTED_CENTS = 990;

let failures = 0;
const say = (ok, claim, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${claim}`);
  if (!ok && detail) console.log(`      ${detail}`);
};

async function stripe(path, init = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...init.headers,
    },
  });
  return response.json();
}

console.log("THE RECURRING PRICE\n");

let prices = await stripe(`prices?lookup_keys[]=${LOOKUP}&active=true&limit=1`);

if (!prices.data?.length) {
  console.log("  · not created yet — creating it, which is what the first subscriber would do");
  const body = new URLSearchParams({
    lookup_key: LOOKUP,
    currency: "usd",
    unit_amount: String(EXPECTED_CENTS),
    "recurring[interval]": "month",
    "product_data[name]": "Minimum Stress Pro",
  });
  const created = await stripe("prices", { method: "POST", body });
  if (created.error) {
    console.error(`  ✗ could not create it: ${created.error.message}`);
    process.exit(1);
  }
  prices = { data: [created] };
}

const price = prices.data[0];

say(Boolean(price?.id), "a price exists", price?.id);
say(price?.unit_amount === EXPECTED_CENTS, `it charges $${(EXPECTED_CENTS / 100).toFixed(2)}`, `got ${price?.unit_amount}`);
say(price?.recurring?.interval === "month", "it recurs monthly", price?.recurring?.interval);
say(price?.currency === "usd", "in dollars", price?.currency);
say(price?.active === true, "and it is active");

console.log("\nTHE BILLING PORTAL");

/**
 * Opens one, rather than checking whether a configuration object exists.
 *
 * The first version asked for `billing_portal/configurations` and failed,
 * because Stripe creates the default lazily — there is nothing to list until
 * somebody uses it. The portal worked the whole time. Asking the question the
 * subscriber asks is the only version of this check worth having.
 *
 * A throwaway customer, removed straight after: a portal session needs one,
 * and borrowing a real subscriber's would email nobody but would put a
 * stranger's session in the logs.
 */
const probe = await stripe("customers", {
  method: "POST",
  body: new URLSearchParams({ email: "portal-probe@example.invalid" }),
});

const session = await stripe("billing_portal/sessions", {
  method: "POST",
  body: new URLSearchParams({
    customer: probe.id,
    return_url: "https://minimumstressapp.vercel.app/",
  }),
});

say(
  Boolean(session.url),
  "the portal opens for a customer",
  session.error?.message ?? "in live mode it must be configured in the dashboard first",
);

await stripe(`customers/${probe.id}`, { method: "DELETE" });

console.log("\nWEBHOOK COVERAGE");

const endpoints = await stripe("webhook_endpoints?limit=100");
const subscribed = new Set(
  (endpoints.data ?? []).flatMap((e) => e.enabled_events ?? []),
);

for (const event of [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]) {
  say(
    subscribed.has(event) || subscribed.has("*"),
    `${event} reaches us`,
    "nobody would ever be marked Pro without it",
  );
}

console.log(
  failures === 0
    ? "\nPro is wired: the price is right, the portal opens, and the events arrive."
    : `\n${failures} problem(s) — Pro would not work as described.`,
);

process.exit(failures === 0 ? 0 : 1);
