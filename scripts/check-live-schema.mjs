import { readFileSync } from "node:fs";

/**
 * Asks the live database whether it has what the code expects.
 *
 * The migrations are applied by hand — someone pastes apply.sql into the SQL
 * editor — so the deployed app and the deployed schema can drift apart without
 * anything failing until a user hits the one path that needs the missing
 * column. This turns that into a question with an answer.
 *
 *   node scripts/check-live-schema.mjs
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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
  process.exit(1);
}

/** What each migration added, in the order they were written. */
const EXPECTED = [
  { migration: "0001", check: "spaces?select=id,hourly_rate_cents,access_type&limit=0" },
  { migration: "0002", check: "spaces_public?select=id&limit=0" },
  { migration: "0005", check: "bookings?select=id,platform_cents&limit=0" },
  { migration: "0007", check: "spaces?select=description,amenities,requirements,house_rules&limit=0" },
  { migration: "0008", check: "spaces?select=map_x,map_y&limit=0" },
  { migration: "0008", check: "spaces_public?select=map_x,map_y&limit=0" },
  { migration: "0009", check: "notifications?select=id,dedupe_key,channel,attempts&limit=0" },
  { migration: "0009", check: "profiles?select=phone,phone_verified_at,notify_sms&limit=0" },
];

async function get(path, key) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return { ok: response.ok, status: response.status, body: (await response.text()).slice(0, 160) };
}

let missing = 0;

for (const { migration, check } of EXPECTED) {
  const result = await get(check, secret);
  const table = check.split("?")[0];
  const columns = new URLSearchParams(check.split("?")[1]).get("select");

  if (result.ok) {
    console.log(`✓ ${migration}  ${table}: ${columns}`);
  } else {
    missing += 1;
    console.log(`✗ ${migration}  ${table}: ${columns}`);
    console.log(`         ${result.body}`);
  }
}

// Not a schema question but the same class of surprise: the whole privacy
// model rests on anon being unable to reach the base tables.
console.log("\nPrivacy boundaries, as the public sees them:");

for (const [label, path, wantOk] of [
  ["spaces_public is readable", "spaces_public?select=id&limit=0", true],
  ["spaces is not", "spaces?select=id&limit=0", false],
  ["lat/lng are absent from the public view", "spaces_public?select=lat&limit=0", false],
  ["notifications are not readable", "notifications?select=id&limit=0", false],
]) {
  const result = await get(path, anon);
  const correct = result.ok === wantOk;
  if (!correct) missing += 1;
  console.log(`${correct ? "✓" : "✗"} ${label} (${result.status})`);
}

console.log(
  missing === 0
    ? "\nLive database matches the migrations."
    : `\n${missing} problem(s). Paste supabase/apply.sql into the Supabase SQL editor and run it.`,
);

process.exit(missing === 0 ? 0 : 1);
