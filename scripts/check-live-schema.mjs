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

/**
 * What each migration added, in the order they were written.
 *
 * This list stopped at 0009 and the deployed schema went nine migrations past
 * it without anything saying so. The app asked `spaces_public` for `lat`,
 * PostgREST returned rows without the column, the repository read `undefined`
 * and mapped it to null, and Discover filtered every listing off its own map.
 * A blank map, no error, and a green test suite — which is the exact failure
 * this file was written to catch and could not, because it was only ever
 * looking at the first nine.
 *
 * So: one entry per migration that added something reachable over REST. A
 * migration that only moves grants or rewrites a trigger has no row here and
 * says so in a comment, rather than being silently absent.
 */
const EXPECTED = [
  { migration: "0001", check: "spaces?select=id,hourly_rate_cents,access_type&limit=0" },
  { migration: "0002", check: "spaces_public?select=id&limit=0" },
  { migration: "0005", check: "bookings?select=id,platform_cents&limit=0" },
  { migration: "0007", check: "spaces?select=description,amenities,requirements,house_rules&limit=0" },
  { migration: "0008", check: "spaces?select=map_x,map_y&limit=0" },
  { migration: "0008", check: "spaces_public?select=map_x,map_y&limit=0" },
  { migration: "0009", check: "notifications?select=id,dedupe_key,channel,attempts&limit=0" },
  { migration: "0009", check: "profiles?select=phone,phone_verified_at,notify_sms&limit=0" },
  { migration: "0011", check: "reviews?select=id&limit=0" },
  { migration: "0011", check: "review_escalations?select=id&limit=0" },
  { migration: "0011", check: "profiles?select=emergency_contact_name,emergency_contact_phone&limit=0" },
  { migration: "0012", check: "profiles?select=account_type&limit=0" },
  { migration: "0013", check: "account_type_change_requests?select=id&limit=0" },
  { migration: "0015", check: "messages?select=id&limit=0" },
  { migration: "0018", check: "spaces?select=sublease_doc_state,insurance_doc_state,doc_review_note&limit=0" },
  { migration: "0020", check: "profiles?select=terms_version,terms_accepted_at&limit=0" },
  { migration: "0022", check: "spaces_public?select=area&limit=0" },
  { migration: "0024", check: "profiles?select=search_postcode&limit=0" },
  { migration: "0025", check: "my_notifications?select=id&limit=0" },
  { migration: "0026", check: "spaces?select=entrance_access,floor_access,doorway_inches,restroom_access&limit=0" },
  { migration: "0026", check: "spaces_public?select=entrance_access,restroom_access&limit=0" },
  { migration: "0029", check: "spaces?select=timezone&limit=0" },
  { migration: "0029", check: "spaces_public?select=timezone&limit=0" },
  { migration: "0030", check: "bookings?select=host_paid_at,refunded_at,refunded_cents,stripe_transfer_id&limit=0" },
  { migration: "0031", check: "spaces?select=parking,parking_limit_minutes&limit=0" },
  { migration: "0031", check: "spaces_public?select=parking,parking_limit_minutes&limit=0" },
  /*
   * The one that took the map down. Discover reads these off spaces_public to
   * place a listing, and without them every room is filtered out of its own
   * map with nothing logged anywhere.
   */
  { migration: "0032", check: "spaces_public?select=lat,lng,address_line&limit=0" },
  { migration: "0033", check: "refund_requests?select=id&limit=0" },
  { migration: "0034", check: "studio_claims?select=id&limit=0" },
  { migration: "0035", check: "spaces?select=floor_area_sqft&limit=0" },
  { migration: "0035", check: "spaces_public?select=floor_area_sqft&limit=0" },
  { migration: "0036", check: "studio_claims?select=stripe_payment_intent_id&limit=0" },
  /*
   * Not listed, and deliberately: 0010, 0014, 0016, 0017, 0019, 0021, 0023,
   * 0027, 0028 and 0037 add triggers, functions, storage policies or column
   * grants. None of those is a column PostgREST will confess to, so a row here
   * would be a check that always passes — worse than no check, because it
   * would read as coverage.
   */
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

/*
 * The line moved in 0032, and this list moved with it.
 *
 * It used to assert that lat/lng were absent from the public view, which was
 * the right test while a listing's position was withheld. 0032 publishes the
 * address on purpose: every listing is a retail studio whose address is on
 * Google Maps and on the sign above its door, so withholding the street number
 * protected nothing and cost a practitioner the fact they judge a room by.
 *
 * What is still private is how to get *inside*: the entry instructions and the
 * access code, which belong to whoever paid for the hour. That is the boundary
 * worth checking, so that is what is checked. The old assertion is not
 * restored — it would now fail against a schema that is correct.
 */
for (const [label, path, wantOk] of [
  ["spaces_public is readable", "spaces_public?select=id&limit=0", true],
  ["spaces is not", "spaces?select=id&limit=0", false],
  ["the address is published, as 0032 intends", "spaces_public?select=address_line&limit=0", true],
  [
    "entry instructions are not",
    "spaces_public?select=entry_instructions&limit=0",
    false,
  ],
  ["bookings are not readable, access codes with them", "bookings?select=id&limit=0", false],
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
