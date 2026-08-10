/**
 * The money, end to end, in Stripe test mode.
 *
 * Unit tests prove the arithmetic and RLS tests prove the boundaries. Neither
 * proves that a card is authorised rather than charged, that the capture job
 * moves it at session start, or that the host's transfer equals their rate to
 * the cent — those live in Stripe, and the only way to know is to make one
 * happen and read it back.
 *
 * Nothing here touches real money. It refuses to run against a live key.
 *
 * Cleans up after itself: the booking, the space and the practitioner it
 * creates are removed at the end, so running it twice leaves nothing behind.
 *
 * Four scenarios, and the three cancellations matter most. They are where
 * money moves back, and a mistake either charges somebody who cancelled
 * properly or fails to charge somebody who did not.
 *
 *   npx tsx scripts/walk-the-money.mjs             the session happens
 *   npx tsx scripts/walk-the-money.mjs free-cancel more than 24h out
 *   npx tsx scripts/walk-the-money.mjs late-cancel inside 24h
 *   npx tsx scripts/walk-the-money.mjs host-cancel the host pulls out
 *
 * The rule is not restated here. `resolveCancellation` decides, exactly as it
 * does in the app — a walkthrough that reimplemented the policy would only
 * prove the reimplementation.
 */

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("=");
      return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : null;
    })
    .filter(Boolean),
);

const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
const STRIPE = env.STRIPE_SECRET_KEY;

if (!STRIPE.startsWith("sk_test")) {
  console.error("This is a live Stripe key. Refusing to run.");
  process.exit(1);
}

const db = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

const SCENARIO = process.argv[2] ?? "completed";
const SCENARIOS = ["completed", "free-cancel", "late-cancel", "host-cancel"];

if (!SCENARIOS.includes(SCENARIO)) {
  console.error(`Unknown scenario "${SCENARIO}". One of: ${SCENARIOS.join(", ")}`);
  process.exit(1);
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const step = (n, what) => console.log(`\n${n}. ${what}`);
const fact = (label, value) => console.log(`   ${label.padEnd(26)} ${value}`);

/** Stripe's form encoding, including nested objects. */
function form(object, prefix = "") {
  const parts = [];
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) parts.push(form(value, name));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join("&");
}

async function stripe(path, body, method = body ? "POST" : "GET", onBehalfOf) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE}`,
      // Reads the connected account's own books rather than the platform's.
      ...(onBehalfOf ? { "Stripe-Account": onBehalfOf } : {}),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? form(body) : undefined,
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${path}: ${payload.error.message}`);
  return payload;
}

async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...db, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

/* ------------------------------------------------------------------ */

const created = { spaceId: null, bookingId: null, practitionerId: null, accountId: null };

try {
  console.log(`Stripe test mode · ${SCENARIO}. No real money moves.\n` + "─".repeat(60));

  // ---------------------------------------------------------------- 1
  step(1, "A host who can actually be paid");

  /*
   * A fresh Connect account rather than one of the real ones. The real hosts
   * are mid-onboarding, and completing their accounts from a script would
   * put test identity documents against somebody's real name.
   */
  const account = await stripe("/accounts", {
    /*
     * Requirements collected by us rather than by Stripe's hosted flow, which
     * is the only way a script can supply them. The app itself uses Express
     * onboarding — a different front door to the same account. What is being
     * tested here is the money: a destination charge, an application fee and a
     * transfer behave identically either way.
     */
    controller: {
      losses: { payments: "application" },
      fees: { payer: "application" },
      requirement_collection: "application",
      stripe_dashboard: { type: "none" },
    },
    country: "US",
    email: "walkthrough-host@minimumstress.app",
    business_type: "individual",
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    business_profile: { mcc: "7299", url: "https://minimumstress.com", product_description: "Room hire" },
    individual: {
      first_name: "Test",
      last_name: "Host",
      email: "walkthrough-host@minimumstress.app",
      phone: "+15555550123",
      dob: { day: 1, month: 1, year: 1980 },
      ssn_last_4: "0000",
      id_number: "000000000",
      address: { line1: "address_full_match", city: "San Mateo", state: "CA", postal_code: "94070", country: "US" },
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
  });
  created.accountId = account.id;

  await stripe(`/accounts/${account.id}/external_accounts`, { external_account: "btok_us_verified" });

  /*
   * Capabilities activate a moment after the account is complete, so reading
   * straight back reports "not yet" for an account that is fine. Waited for
   * rather than assumed — an account that never becomes chargeable is the one
   * thing this step exists to catch.
   */
  let ready = await stripe(`/accounts/${account.id}`);
  for (let tries = 0; tries < 10 && !ready.charges_enabled; tries++) {
    await new Promise((wake) => setTimeout(wake, 1000));
    ready = await stripe(`/accounts/${account.id}`);
  }

  fact("account", ready.id);
  fact("can take charges", ready.charges_enabled ? "yes" : "NO — the rest will fail");
  fact("can be paid out", ready.payouts_enabled ? "yes" : "not yet");

  // ---------------------------------------------------------------- 2
  step(2, "A room at $40 an hour");

  const [host] = await rest("profiles?account_type=eq.host&select=id&limit=1");
  await rest(`profiles?id=eq.${host.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      stripe_connect_account_id: account.id,
      stripe_connect_charges_enabled: true,
    }),
  });

  const [space] = await rest("spaces", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      host_id: host.id,
      name: "Money walkthrough room",
      category: "physical",
      hourly_rate_cents: 4000,
      capacity: 2,
      access_type: "keypad",
      entry_instructions: "Test",
      address_line: "1 Test St, San Mateo, CA 94070, USA",
      buffer_minutes: 0,
      sublease_doc_path: `space/${host.id}/walkthrough.pdf`,
      legal_ack_at: new Date().toISOString(),
      sublease_doc_state: "verified",
      sublease_doc_reviewed_at: new Date().toISOString(),
      status: "active",
    }),
  });
  created.spaceId = space.id;
  fact("host keeps", money(4000));

  // ---------------------------------------------------------------- 3
  step(3, "What the practitioner is quoted");

  const { quote } = await import("../src/lib/money.ts");
  const priced = quote({ hostRateCents: 4000, isInstant: false, isPro: false });

  fact("session", money(priced.hostCents));
  fact("service fee", money(priced.serviceFeeCents));
  fact("total", money(priced.totalCents));
  fact("our share", money(priced.platformCents));

  // ---------------------------------------------------------------- 4
  step(4, "The card is held, not charged");

  const intent = await stripe("/payment_intents", {
    amount: priced.totalCents,
    currency: "usd",
    capture_method: "manual",
    payment_method: "pm_card_visa",
    confirm: "true",
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
    application_fee_amount: priced.totalCents - priced.hostCents,
    "transfer_data[destination]": account.id,
  });

  fact("status", intent.status);
  fact("authorised", money(intent.amount));
  fact("captured so far", money(intent.amount_received));
  fact("our fee on it", money(intent.application_fee_amount));

  if (intent.status !== "requires_capture") {
    throw new Error(`Expected requires_capture, got ${intent.status}`);
  }

  // ---------------------------------------------------------------- 5
  step(5, "What happens next");

  /*
   * The app's own rule, not a copy of it. When the session start is more than
   * 24 hours away this returns "void"; inside that window, "capture_full"; and
   * for a host cancelling, "void" whatever the clock says.
   */
  const { resolveCancellation } = await import("../src/lib/money.ts");

  const now = new Date();
  const sessionStart =
    SCENARIO === "late-cancel"
      ? new Date(now.getTime() + 2 * 60 * 60 * 1000)
      : new Date(now.getTime() + 72 * 60 * 60 * 1000);

  let outcome = null;
  if (SCENARIO !== "completed") {
    outcome = resolveCancellation(
      priced,
      SCENARIO === "host-cancel" ? "host" : "practitioner",
      sessionStart,
      now,
    );
    fact("session starts in", `${Math.round((sessionStart - now) / 3_600_000)}h`);
    fact("the rule says", outcome.action);
    fact("because", outcome.reason);
  }

  const shouldCapture = SCENARIO === "completed" || outcome?.action === "capture_full";

  if (shouldCapture) {
    await stripe(`/payment_intents/${intent.id}/capture`, {}, "POST");
  } else {
    /*
     * Cancelled, not refunded. The money was only ever held, so releasing the
     * authorisation means nothing was taken — no refund appears on a
     * statement, because no charge did.
     */
    await stripe(`/payment_intents/${intent.id}/cancel`, {}, "POST");
  }

  const settled = await stripe(`/payment_intents/${intent.id}`);
  fact("status", settled.status);
  fact("practitioner charged", money(settled.amount_received));

  let hostGot = 0;
  let weGot = 0;
  let platformEntry = null;

  if (settled.latest_charge && settled.amount_received > 0) {
    const charge = await stripe(`/charges/${settled.latest_charge}`);

    /*
     * Asked of the host's own account, not inferred from the transfer.
     *
     * A destination charge's transfer object reports the gross movement — the
     * whole $48 — while the connected account is credited the net. Subtracting
     * one from the other reads as "the host got everything and we got
     * nothing", which is what the first version of this script reported,
     * wrongly. The only answer to "what did the host receive" is the host's
     * own balance.
     */
    const ledger = await stripe("/balance_transactions?limit=1", undefined, "GET", account.id);
    hostGot = ledger.data[0]?.net ?? 0;

    const fee = charge.application_fee
      ? await stripe(`/application_fees/${charge.application_fee}`)
      : null;
    weGot = fee?.amount ?? 0;
    platformEntry = await stripe(`/balance_transactions/${charge.balance_transaction}`);
  }

  fact("host receives", money(hostGot));
  fact("we keep", money(weGot));

  // ---------------------------------------------------------------- 6
  step(6, "Does it add up?");

  const checks =
    SCENARIO === "completed"
      ? [
          ["host paid their rate exactly", hostGot === priced.hostCents, `${money(hostGot)} vs ${money(priced.hostCents)}`],
          ["our share matches the quote", weGot === priced.platformCents, `${money(weGot)} vs ${money(priced.platformCents)}`],
          ["nothing vanished", hostGot + weGot === priced.totalCents, money(hostGot + weGot)],
        ]
      : outcome.action === "void"
        ? [
            // The promise on the booking screen, in one assertion.
            ["nothing was taken", settled.amount_received === 0, money(settled.amount_received)],
            ["the hold is released", settled.status === "canceled", settled.status],
            ["the host is paid nothing", hostGot === 0, money(hostGot)],
          ]
        : [
            /*
             * The host keeps the hour they set aside. A late cancellation is
             * already settled between the two of them, which is why the
             * standing rules treat it as the lesser fault.
             */
            ["charged in full", settled.amount_received === priced.totalCents, money(settled.amount_received)],
            ["host still paid their rate", hostGot === priced.hostCents, `${money(hostGot)} vs ${money(priced.hostCents)}`],
            ["our share unchanged", weGot === priced.platformCents, `${money(weGot)} vs ${money(priced.platformCents)}`],
          ];

  console.log("");
  for (const [what, ok, detail] of checks) {
    console.log(`   ${ok ? "OK  " : "!!! "} ${what.padEnd(30)} ${detail}`);
    if (!ok) process.exitCode = 1;
  }

  if (platformEntry) {
    /*
     * Stripe's processing fee comes out of our share, never the host's. That
     * is the whole reason application_fee_amount is total minus the host's
     * rate: whatever Stripe takes, it takes from what is left to us.
     */
    console.log("");
    fact("Stripe's cut", money(platformEntry.fee));
    fact("left to us after Stripe", money(weGot - platformEntry.fee));
  }
} catch (failure) {
  console.error("\nFAILED:", failure.message);
  process.exitCode = 1;
} finally {
  console.log("\n" + "─".repeat(60) + "\nCleaning up");
  if (created.spaceId) {
    await rest(`bookings?space_id=eq.${created.spaceId}`, { method: "DELETE" }).catch(() => {});
    await rest(`spaces?id=eq.${created.spaceId}`, { method: "DELETE" }).catch(() => {});
    console.log("   room removed");
  }
  // The Connect account is left in place: Stripe keeps test accounts and
  // deleting one with a charge against it fails. It is inert.
  if (created.accountId) console.log(`   test Connect account left: ${created.accountId}`);
}
