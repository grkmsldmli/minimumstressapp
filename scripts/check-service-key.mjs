/**
 * Is the Supabase service key the server actually holds a working one?
 *
 * Every admin route builds its client with SUPABASE_SECRET_KEY, and
 * supabaseSecretKey() throws outright when it is missing — which arrives at
 * the browser as a bare 500 with no clue in it. A rejected key is worse: the
 * client builds fine and every query comes back empty, so the route answers
 * something plausible and wrong.
 *
 * Prints a status, never the key.
 *
 *   node scripts/check-service-key.mjs
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
          // Strip the BOM Windows editors leave on the first line, which
          // otherwise becomes part of the first variable's name.
          return [line.slice(0, at).trim().replace(/^﻿/, ""), line.slice(at + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

const file = envFrom(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? file.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? file.SUPABASE_SECRET_KEY;

if (!url) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not set. Nothing to check.");
  process.exit(1);
}
if (!key) {
  console.error("SUPABASE_SECRET_KEY is not set — every admin route will answer 500.");
  process.exit(1);
}

console.log(`project: ${url}`);
console.log(`key: ${key.slice(0, 8)}… (${key.length} characters)`);

const response = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});

if (response.ok) {
  console.log("PostgREST: accepted. Admin routes can read.");
  process.exit(0);
}

console.error(`PostgREST: rejected with ${response.status}.`);
console.error((await response.text()).slice(0, 300));
console.error(
  "\nCopy it again from Settings -> API Keys -> Secret keys, using the copy\n" +
    "button rather than reading it off the screen: the panel shows a masked\n" +
    "form that looks like a key and is not one.",
);
process.exit(1);
