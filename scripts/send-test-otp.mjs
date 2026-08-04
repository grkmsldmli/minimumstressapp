import { readFileSync } from "node:fs";

/**
 * Exercises the one email path the app does not send itself.
 *
 * Supabase sends the login code, over whatever SMTP it is configured with, so
 * our own tests cannot cover it. The only honest check is to make it send one
 * and then spend it.
 *
 *   node scripts/send-test-otp.mjs you@example.com          # ask for a code
 *   node scripts/send-test-otp.mjs you@example.com 237425   # redeem it
 *
 * Sending proves the mail leaves. Redeeming proves the loop closes — it is the
 * same call the auth screen makes, so a length or template mismatch surfaces
 * here rather than on somebody's phone.
 */

const to = process.argv[2];
const code = process.argv[3];

if (!to) {
  console.error("Usage: node scripts/send-test-otp.mjs you@example.com [code-from-the-email]");
  process.exitCode = 1;
} else {
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

  const post = (path, payload) =>
    fetch(`${url}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  if (code) {
    const response = await post("verify", { email: to, token: code, type: "email" });
    const payload = await response.json();

    if (response.ok) {
      console.log(`✓ code accepted — signed in as ${payload.user?.email}`);
      console.log(`  user id:  ${payload.user?.id}`);
      console.log(`  session:  expires in ${payload.expires_in}s`);
    } else {
      console.error(`✗ ${response.status}: ${payload.msg ?? payload.error_description ?? ""}`);
      process.exitCode = 1;
    }
  } else {
    const started = Date.now();
    const response = await post("otp", { email: to, create_user: true });
    const body = await response.text();

    if (response.ok) {
      console.log(`✓ Supabase accepted the request in ${Date.now() - started}ms`);
      console.log(`  A code should reach ${to}.`);
      console.log(`  Sender hello@minimumstress.app means Resend carried it.`);
      console.log(`  Run again with the code to prove it actually signs you in.`);
    } else {
      console.error(`✗ ${response.status}: ${body.slice(0, 300)}`);
      // The rate limit is the specific failure the Resend integration exists to
      // remove, so it is worth naming rather than leaving as a status code.
      if (/rate limit|too many/i.test(body)) {
        console.error("  That is the built-in email rate limit — the integration is not in effect.");
      }
      process.exitCode = 1;
    }
  }
}
