import { readFileSync } from "node:fs";

/**
 * Runs the scheduled job now, against a deployed environment.
 *
 * Vercel's Hobby plan allows one cron run a day, which makes "did that
 * deploy's job actually work" a 24-hour question otherwise. The endpoint is
 * built to be safe to call at any time — it compares state to the clock rather
 * than tracking what it did last — so triggering it by hand is a real test
 * rather than a simulation of one.
 *
 *   node scripts/run-cron.mjs https://minimumstressapp.vercel.app
 *
 * Also checks that the endpoint refuses an unauthenticated request, because
 * without the secret it is a public button for capturing everyone's payments
 * early.
 */

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/run-cron.mjs https://your-app.vercel.app");
  process.exit(1);
}

const url = new URL("/api/cron", base).toString();

const secret = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("CRON_SECRET="))
  ?.slice("CRON_SECRET=".length)
  .trim();

if (!secret) {
  console.error("CRON_SECRET is not set in .env.local");
  process.exit(1);
}

const unauthorised = await fetch(url);
const guarded = unauthorised.status === 401;
console.log(`${guarded ? "✓" : "✗"} refuses an unauthenticated request (${unauthorised.status})`);

const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
const body = await response.text();

if (!response.ok) {
  console.error(`✗ run failed (${response.status}): ${body.slice(0, 400)}`);
  process.exit(1);
}

console.log(`✓ ran (${response.status})`);
console.log(JSON.stringify(JSON.parse(body), null, 2));

process.exit(guarded ? 0 : 1);
