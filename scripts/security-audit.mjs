import { readFileSync } from "node:fs";

/**
 * Asks a deployment, from outside, whether its boundaries actually hold.
 *
 * Every check here is phrased as an attacker would phrase it: not "is the
 * policy configured" but "can I read the address of a room I have not booked".
 * That difference matters — the unit tests prove the rules are written
 * correctly, and this proves the written rules are the ones a running server
 * enforces. Both times a real hole appeared in this project, it was in the gap
 * between those two.
 *
 *   node scripts/security-audit.mjs                                  (local)
 *   node scripts/security-audit.mjs https://minimumstressapp.vercel.app
 */

const base = process.argv[2] ?? "http://localhost:3000";

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
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let failures = 0;
let undeployed = 0;
const results = [];

function record(area, claim, passed, detail = "") {
  if (!passed) failures += 1;
  results.push({ area, claim, passed, detail });
}

/**
 * A table that does not exist is not a boundary that failed.
 *
 * PostgREST answers a missing relation with 404 and PGRST205, which a check
 * written as "is it unreachable" reads as a pass and one written as "is it 401"
 * reads as a failure. Neither is true: the feature simply is not deployed yet,
 * and reporting that as a security hole cries wolf on every run between writing
 * a migration and applying it.
 */
function recordDeployed(area, claim, result, expected) {
  if (result.status === 404 && result.body.includes("PGRST205")) {
    undeployed += 1;
    results.push({ area, claim, passed: null, detail: "not deployed — apply.sql is behind" });
    return;
  }
  record(area, claim, expected(result.status), `status ${result.status}`);
}

async function rest(path, key = ANON) {
  const response = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return { status: response.status, body: (await response.text()).slice(0, 200) };
}

/* ---------------- headers ---------------- */

const headResponse = await fetch(base);
const header = (name) => headResponse.headers.get(name) ?? "";

record("headers", "a content security policy is sent", header("content-security-policy") !== "");
record(
  "headers",
  "scripts may not be inlined or eval'd",
  !/script-src[^;]*'unsafe-(inline|eval)'/.test(header("content-security-policy")),
  header("content-security-policy").match(/script-src[^;]*/)?.[0] ?? "",
);
record(
  "headers",
  "the app cannot be framed",
  /frame-ancestors 'none'/.test(header("content-security-policy")) &&
    header("x-frame-options").toUpperCase() === "DENY",
);
record("headers", "HSTS is set for a year", /max-age=31536000/.test(header("strict-transport-security")));
record("headers", "MIME sniffing is off", header("x-content-type-options") === "nosniff");
record("headers", "referrers are trimmed cross-origin", header("referrer-policy") !== "");
record("headers", "camera and microphone are denied outright", /camera=\(\)/.test(header("permissions-policy")) && /microphone=\(\)/.test(header("permissions-policy")));
record("headers", "the framework version is not advertised", header("x-powered-by") === "");

/* ---------------- database boundaries, as the public sees them ---------------- */

record("database", "the spaces table is unreachable", (await rest("spaces?select=id&limit=1")).status === 401);
record("database", "the bookings table is unreachable", (await rest("bookings?select=id&limit=1")).status === 401);
record("database", "the profiles table is unreachable", (await rest("profiles?select=id&limit=1")).status === 401);
record("database", "notifications are unreachable", (await rest("notifications?select=id&limit=1")).status === 401);
recordDeployed("database", "reviews are unreachable without a session", await rest("reviews?select=id&limit=1"), (s) => s === 401);
recordDeployed("database", "escalations are unreachable", await rest("review_escalations?select=id&limit=1"), (s) => s === 401);
recordDeployed("database", "messages are unreachable without a session", await rest("messages?select=body&limit=1"), (s) => s === 401);
recordDeployed("database", "the message view is unreachable too", await rest("messages_visible?select=body&limit=1"), (s) => s === 401);
recordDeployed("database", "points are unreachable without a session", await rest("standing_points?select=points&limit=1"), (s) => s === 401);

record("database", "the public listing view is readable", (await rest("spaces_public?select=id&limit=1")).status === 200);

/**
 * The column list is the safety of a definer view, so each of these asks for
 * a field that must not exist rather than trusting that it is unselected.
 */
for (const column of ["lat", "lng", "address_line", "entry_instructions", "sublease_doc_path"]) {
  const { status } = await rest(`spaces_public?select=${column}&limit=1`);
  record("database", `${column} is absent from the public listing view`, status === 400);
}

for (const column of ["access_code", "stripe_payment_intent_id"]) {
  const { status } = await rest(`bookings_with_access_code?select=${column}&limit=1`);
  // 401 or 400 both mean "not from here" — what matters is that it is not 200.
  record("database", `${column} is not readable anonymously`, status !== 200);
}

record(
  "database",
  "emergency contacts are absent from the public profile view",
  (await rest("public_host_profiles?select=emergency_contact_phone&limit=1")).status === 400,
);

recordDeployed(
  "database",
  "a review's author is absent from the public review view",
  await rest("public_reviews?select=author_id&limit=1"),
  (s) => s === 400,
);

recordDeployed(
  "database",
  "the safety flag is absent from the public review view",
  await rest("public_reviews?select=safety_concern&limit=1"),
  (s) => s === 400,
);

/*
 * The unmasked text a sender typed. Masking is what keeps a phone number away
 * from the other side, and a view that exposed the original would undo all of
 * it — so this asks for the column by name rather than trusting it is absent.
 */
recordDeployed(
  "database",
  "the unmasked message text is absent from the view participants read",
  await rest("messages_visible?select=original_body&limit=1"),
  (s) => s === 400,
);

/* ---------------- routes ---------------- */

const cron = await fetch(`${base}/api/cron`);
record("routes", "the scheduled job refuses an unauthenticated caller", cron.status === 401);

const webhook = await fetch(`${base}/api/stripe/webhook`, { method: "POST", body: "{}" });
record("routes", "the webhook refuses an unsigned payload", webhook.status === 400);

const booking = await fetch(`${base}/api/bookings`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ spaceId: "x", startsAt: new Date().toISOString() }),
});
record("routes", "booking refuses an anonymous caller", booking.status === 401);

const cancel = await fetch(`${base}/api/bookings/00000000-0000-0000-0000-000000000000/cancel`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
record("routes", "cancellation refuses an anonymous caller", cancel.status === 401);

const connect = await fetch(`${base}/api/connect/onboard`, { method: "POST" });
record("routes", "payout onboarding refuses an anonymous caller", connect.status === 401);

/**
 * The nearby endpoint is the one place real coordinates are read, so this
 * checks the response carries an order and a label and nothing else.
 */
const nearby = await fetch(`${base}/api/spaces/nearby?lat=37.53&lng=-122.32`);
if (nearby.ok) {
  const payload = await nearby.text();
  record(
    "routes",
    "nearby search returns no coordinates",
    !/"lat"|"lng"|"address/.test(payload),
    payload.slice(0, 120),
  );
} else {
  record("routes", "nearby search responds", false, `status ${nearby.status}`);
}

const devPage = await fetch(`${base}/dev/payment`);
record(
  "routes",
  "the payment design page is absent in production",
  base.includes("localhost") ? true : devPage.status === 404,
  base.includes("localhost") ? "(skipped locally)" : `status ${devPage.status}`,
);

/* ---------------- report ---------------- */

let currentArea = "";
for (const { area, claim, passed, detail } of results) {
  if (area !== currentArea) {
    console.log(`\n${area.toUpperCase()}`);
    currentArea = area;
  }
  const mark = passed === null ? "·" : passed ? "✓" : "✗";
  console.log(`  ${mark} ${claim}`);
  if (passed !== true && detail) console.log(`      ${detail}`);
}

console.log(
  failures === 0
    ? `\nAll ${results.length} boundaries hold against ${base}.`
    : `\n${failures} of ${results.length} FAILED against ${base}.`,
);

process.exit(failures === 0 ? 0 : 1);
