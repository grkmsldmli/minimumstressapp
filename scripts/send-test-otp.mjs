import { readFileSync } from "node:fs";

/**
 * Asks Supabase Auth to send a real login code.
 *
 * This is the one email path the app does not send itself — Supabase does,
 * over whatever SMTP it is configured with. So it is also the one path our own
 * tests cannot cover, and the only honest check is to make it send one.
 *
 *   node scripts/send-test-otp.mjs you@example.com
 *
 * Without the Resend integration, Supabase uses its own sender and limits the
 * free tier to a handful of emails an hour — enough to look like it works in
 * testing and to fail the first time two people sign in at once.
 */

const to = process.argv[2];
if (!to) {
  console.error("Usage: node scripts/send-test-otp.mjs you@example.com");
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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const started = Date.now();

const response = await fetch(`${url}/auth/v1/otp`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email: to, create_user: true }),
});

const elapsed = Date.now() - started;
const body = await response.text();

if (response.ok) {
  console.log(`✓ Supabase accepted the request in ${elapsed}ms`);
  console.log(`  A six-digit code should reach ${to}.`);
  console.log(`  Check the sender: hello@minimumstress.app means Resend carried it.`);
} else {
  console.error(`✗ ${response.status}: ${body.slice(0, 300)}`);
  // The rate limit is the specific failure this integration exists to remove,
  // so it is worth naming rather than leaving as a status code.
  if (/rate limit|too many/i.test(body)) {
    console.error("  That is the built-in email rate limit — the integration is not in effect.");
  }
  process.exit(1);
}
