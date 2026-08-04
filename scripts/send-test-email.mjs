import { readFileSync } from "node:fs";

/**
 * Sends one real message of every kind, so the wording can be read in an inbox
 * rather than in a test assertion.
 *
 *   node scripts/send-test-email.mjs you@example.com [kind]
 *
 * Until a domain is verified, Resend only accepts `onboarding@resend.dev` as
 * the sender and only delivers to the address that owns the account. Both of
 * those produce a 403 with a clear message, which this prints rather than
 * swallowing.
 */

const to = process.argv[2];
const only = process.argv[3];

if (!to) {
  console.error("Usage: node scripts/send-test-email.mjs you@example.com [kind]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("=");
      return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : null;
    })
    .filter(Boolean),
);

if (!env.RESEND_API_KEY || env.RESEND_API_KEY.startsWith("BURAYA")) {
  console.error("RESEND_API_KEY is not set in .env.local");
  process.exit(1);
}

const { render, toHtml } = await import("../src/lib/notify/messages.ts");

const SAMPLES = {
  booking_confirmed: {
    name: "Elena",
    spaceName: "Willow Reformer Studio",
    when: "Tuesday, Mar 4, 11:00 AM",
    amountCents: 5400,
  },
  host_new_booking: {
    name: "Görkem",
    spaceName: "Willow Reformer Studio",
    when: "Tuesday, Mar 4, 11:00 AM",
    amountCents: 4500,
  },
  access_code_ready: {
    name: "Elena",
    spaceName: "Willow Reformer Studio",
    when: "11:00 AM",
    address: "1301 W Hillsdale Blvd, San Mateo, CA",
    accessCode: "4417",
    entryInstructions: "Keypad is on the right-hand door frame. Press # after the code.",
  },
  // The three cancellation outcomes, sent separately because they are three
  // different pieces of news and only one of them is a refund.
  cancelled_by_practitioner: {
    name: "Elena",
    spaceName: "Willow Reformer Studio",
    when: "Tuesday, Mar 4, 11:00 AM",
    chargedCents: 0,
    refundedCents: 0,
  },
  cancelled_late: {
    kind: "cancelled_by_practitioner",
    name: "Elena",
    spaceName: "Willow Reformer Studio",
    when: "Tuesday, Mar 4, 11:00 AM",
    chargedCents: 5400,
    refundedCents: 0,
  },
  cancelled_by_host: {
    name: "Elena",
    spaceName: "Willow Reformer Studio",
    when: "Tuesday, Mar 4, 11:00 AM",
    chargedCents: 0,
    refundedCents: 0,
    creditCents: 900,
  },
  reliability_warning: { name: "Görkem", strikes: 2, limit: 3 },
  reliability_suspended: { name: "Görkem", strikes: 3, until: "18 March" },
  payout_failed: { name: "Görkem", reason: "the account number could not be found" },
};

const from = env.NOTIFY_FROM_EMAIL || "Minimum Stress <onboarding@resend.dev>";
const kinds = only ? [only] : Object.keys(SAMPLES);

console.log(`from: ${from}\nto:   ${to}\n`);

for (const name of kinds) {
  const context = SAMPLES[name];
  if (!context) {
    console.error(`✗ ${name}: unknown — try one of ${Object.keys(SAMPLES).join(", ")}`);
    continue;
  }

  // A sample may name a kind it varies, so one kind can be shown in more than
  // one state without inventing a second kind for it.
  const { kind = name, ...rest } = context;
  const message = render(kind, rest);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `[test] ${message.subject}`,
      text: message.body,
      html: toHtml(message),
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (response.ok) {
    console.log(`✓ ${name.padEnd(26)} ${message.subject}`);
    if (message.sms) console.log(`  sms (${message.sms.length} chars): ${message.sms}`);
  } else {
    console.error(`✗ ${name.padEnd(26)} ${response.status} ${payload.message ?? JSON.stringify(payload)}`);
  }

  // Resend's free tier limits how fast requests may arrive.
  await new Promise((resolve) => setTimeout(resolve, 600));
}
