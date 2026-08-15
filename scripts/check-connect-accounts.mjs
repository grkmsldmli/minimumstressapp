/**
 * Do the Connect account ids we stored still exist under the Stripe key we hold?
 *
 * Local and production point at the same Supabase project but read
 * STRIPE_SECRET_KEY from different places. An id written during onboarding
 * under one key does not resolve under another — Stripe answers "No such
 * account", which is a StripeError carrying `statusCode` rather than `status`,
 * so handled() does not recognise it and the host gets a bare 500.
 *
 * Prints account ids, which are not secrets, and never a key.
 *
 *   node scripts/check-connect-accounts.mjs
 */

import { readFileSync } from "node:fs";

function envFrom(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at).trim().replace(/^﻿/, ""), line.slice(at + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

const file = envFrom(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? file.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? file.SUPABASE_SECRET_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY ?? file.STRIPE_SECRET_KEY;

if (!url || !secret || !stripeKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and STRIPE_SECRET_KEY.");
  process.exit(1);
}

console.log(`stripe key: ${stripeKey.startsWith("sk_test_") ? "TEST mode" : "LIVE mode"}`);

const response = await fetch(
  `${url}/rest/v1/profiles?select=id,stripe_connect_account_id&stripe_connect_account_id=not.is.null`,
  { headers: { apikey: secret, Authorization: `Bearer ${secret}` } },
);

if (!response.ok) {
  console.error(`Supabase rejected the read: ${response.status}`);
  console.error((await response.text()).slice(0, 200));
  process.exit(1);
}

const rows = await response.json();
if (rows.length === 0) {
  console.log("No profile has a Connect account id. Nothing to check.");
  process.exit(0);
}

const { default: Stripe } = await import("stripe");
const stripe = new Stripe(stripeKey);

let broken = 0;
for (const row of rows) {
  const id = row.stripe_connect_account_id;
  try {
    const account = await stripe.accounts.retrieve(id);
    console.log(`${id}: found · payouts ${account.payouts_enabled ? "on" : "off"}`);
  } catch (error) {
    broken += 1;
    console.log(`${id}: NOT FOUND under this key — ${error.message}`);
  }
}

if (broken > 0) {
  console.error(
    `\n${broken} stored id${broken === 1 ? " does" : "s do"} not exist under this Stripe key.\n` +
      "That is the 500: the id was written during onboarding under a different\n" +
      "key, so every link built from it fails. Point both environments at the\n" +
      "same Stripe account, or have those hosts onboard again.",
  );
  process.exit(1);
}
console.log("\nEvery stored id resolves under this key.");
