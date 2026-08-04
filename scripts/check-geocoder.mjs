import { readFileSync } from "node:fs";

/**
 * Measures the address field against the queries that exposed each provider's
 * limits, through the running app rather than against the provider directly.
 *
 * Going through /api/geocode is the point. A direct call proves the provider
 * works; this proves the provider *we are configured to use* works, which is
 * not the same thing — a run that looked green once turned out to be measuring
 * the fallback, because the key had never been loaded.
 *
 *   npm run dev
 *   node scripts/check-geocoder.mjs
 *   node scripts/check-geocoder.mjs https://minimumstressapp.vercel.app
 */

const base = process.argv[2] ?? "http://localhost:3000";

/**
 * Partial input is the whole test. A geocoder answers a complete address well
 * and falls apart halfway through one, which is the state a field is in for
 * every keystroke but the last.
 */
const CASES = [
  { query: "1301 w hillsdale", expect: /hillsdale/i, note: "half-typed, no city" },
  { query: "1301 w hillsdale blv", expect: /hillsdale/i, note: "abbreviated" },
  { query: "450 sutter st san fran", expect: /sutter/i, note: "city half-typed" },
  { query: "1 infinite loop", expect: /infinite loop/i, note: "no city at all" },
  { query: "blue bottle coffee", expect: /blue bottle/i, note: "business by name" },
];

const session = crypto.randomUUID();
let failures = 0;
let provider = "unknown";

for (const testCase of CASES) {
  const url = new URL("/api/geocode", base);
  url.searchParams.set("q", testCase.query);
  url.searchParams.set("session", session);

  let body;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    body = await response.json();
  } catch (error) {
    console.log(`✗ "${testCase.query}" — ${error.message}`);
    failures += 1;
    continue;
  }

  provider = body.provider ?? provider;
  const top = body.suggestions?.[0];
  const line = top ? `${top.primary} | ${top.secondary}` : "(nothing)";
  const passed = top && testCase.expect.test(line);

  if (!passed) failures += 1;
  console.log(`${passed ? "✓" : "✗"} ${testCase.note.padEnd(20)} "${testCase.query}"`);
  console.log(`     ${line}`);
}

console.log(`\nprovider: ${provider}`);
console.log(
  failures === 0
    ? "Every query resolved to the right place."
    : `${failures} of ${CASES.length} did not.`,
);

// A reminder rather than a check: the key is read by the server, so a stale
// dev server reports the old provider no matter what the file says.
if (provider !== "google") {
  const configured = readFileSync(".env.local", "utf8").includes("GOOGLE_PLACES_API_KEY=");
  if (configured) {
    console.log("\n.env.local has a Places key but the server is not using it — restart `npm run dev`.");
  }
}

process.exit(failures === 0 ? 0 : 1);
