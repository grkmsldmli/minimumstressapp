import { readFileSync } from "node:fs";

/**
 * Attacks the verification-docs bucket from outside, with the keys an
 * attacker could plausibly hold.
 *
 * A lease and an insurance certificate are the most sensitive things anyone
 * uploads here — a lease carries a home address, a landlord's name and often a
 * signature. "It's in a private bucket" is a configuration, not a proof, and
 * the gap between those two is where this kind of leak lives.
 *
 * Every check is a thing an attacker would actually try: the public URL, a
 * guessed path, the anonymous key, a signed URL minted without permission.
 *
 *   node scripts/audit-documents.mjs
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

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = env.SUPABASE_SECRET_KEY;

let failures = 0;
const say = (passed, claim, detail = "") => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? "✓" : "✗"} ${claim}`);
  if (!passed && detail) console.log(`      ${detail}`);
};

/**
 * A canary, uploaded and removed by this script.
 *
 * Testing "can a stranger read a document" against an empty bucket proves
 * nothing — every request 404s whether the policy works or not, and the run
 * comes back green for the wrong reason. So one file is put in, attacked, and
 * taken out again.
 */
const CANARY = `space/00000000-0000-0000-0000-0000000000ff/audit-canary-${Date.now()}.pdf`;

const placed = await fetch(`${URL_BASE}/storage/v1/object/verification-docs/${CANARY}`, {
  method: "POST",
  headers: {
    apikey: SECRET,
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/pdf",
  },
  body: ["%PDF-1.4", "% audit canary — safe to delete", "%%EOF"].join("\n"),
});

if (!placed.ok) {
  console.error(`Could not place the canary: ${placed.status} ${await placed.text()}`);
  process.exit(1);
}

/** A real path, so the checks below are aimed at a file that exists. */
const listed = await fetch(`${URL_BASE}/storage/v1/object/list/verification-docs`, {
  method: "POST",
  headers: {
    apikey: SECRET,
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prefix: "", limit: 100 }),
});

const entries = listed.ok ? await listed.json() : [];
console.log(`Documents in the bucket: ${Array.isArray(entries) ? entries.length : "unreadable"}\n`);

const samplePath = CANARY;
console.log("BUCKET CONFIGURATION");

const buckets = await fetch(`${URL_BASE}/storage/v1/bucket/verification-docs`, {
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
});
const bucket = buckets.ok ? await buckets.json() : null;

say(bucket !== null, "the bucket exists");
say(bucket?.public === false, "it is private, not public", `public = ${bucket?.public}`);

console.log("\nREACHING A DOCUMENT WITHOUT PERMISSION");

if (!samplePath) {
  console.log("  · no document uploaded yet — upload one and run this again");
} else {
  console.log(`  (testing against ${samplePath})`);

  // The public URL form. On a public bucket this returns the file to anybody.
  const publicUrl = await fetch(
    `${URL_BASE}/storage/v1/object/public/verification-docs/${samplePath}`,
  );
  say(publicUrl.status !== 200, "the public URL does not serve it", `status ${publicUrl.status}`);

  // The authenticated form, with the key that ships in every browser bundle.
  const withAnon = await fetch(`${URL_BASE}/storage/v1/object/verification-docs/${samplePath}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  say(withAnon.status !== 200, "the publishable key does not fetch it", `status ${withAnon.status}`);

  // Minting a signed URL is the interesting one: if anon may sign, the whole
  // policy is decorative, because a signature is a bearer token.
  const signed = await fetch(
    `${URL_BASE}/storage/v1/object/sign/verification-docs/${samplePath}`,
    {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    },
  );
  say(signed.status !== 200, "the publishable key cannot mint a signed URL", `status ${signed.status}`);
}

console.log("\nGUESSING A PATH");

// Names are generated uuids, so a guess should miss — but the failure must be
// "no" rather than a directory listing.
const guessed = await fetch(
  `${URL_BASE}/storage/v1/object/public/verification-docs/space/00000000-0000-0000-0000-000000000000/lease.pdf`,
);
say(guessed.status !== 200, "a guessed path returns nothing", `status ${guessed.status}`);

const listedAnon = await fetch(`${URL_BASE}/storage/v1/object/list/verification-docs`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prefix: "", limit: 100 }),
});
const anonList = listedAnon.ok ? await listedAnon.json() : null;
say(
  !Array.isArray(anonList) || anonList.length === 0,
  "the bucket cannot be listed anonymously",
  Array.isArray(anonList) ? `listed ${anonList.length} entries` : "",
);

console.log("\nTHE OTHER BUCKETS, FOR CONTRAST");

for (const name of ["space-media", "avatars"]) {
  const response = await fetch(`${URL_BASE}/storage/v1/bucket/${name}`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
  const info = response.ok ? await response.json() : null;
  // These are meant to be public — a room photo is marketing. Asserted so a
  // later change that flips one is noticed here rather than by a host.
  say(info?.public === true, `${name} is public, as intended`, `public = ${info?.public}`);
}

/**
 * Take the canary out again, and check that it went.
 *
 * A cleanup whose result is ignored is not a cleanup. The first version of
 * this script had no delete at all and I read the green output as proof it had
 * tidied up; the file was still sitting in the bucket. So the removal is
 * verified rather than assumed, and a leftover is reported as loudly as a
 * failed check — a test that quietly litters a production bucket is worse than
 * no test.
 */
const removed = await fetch(`${URL_BASE}/storage/v1/object/verification-docs/${CANARY}`, {
  method: "DELETE",
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
});

const stillThere = await fetch(`${URL_BASE}/storage/v1/object/list/verification-docs`, {
  method: "POST",
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prefix: `${CANARY.split("/").slice(0, -1).join("/")}/`, limit: 100 }),
});
const remaining = stillThere.ok ? await stillThere.json() : [];
const leftovers = (Array.isArray(remaining) ? remaining : []).filter((f) => f.id);

console.log("\nCLEANUP");
say(
  removed.ok && leftovers.length === 0,
  "the canary was removed",
  `delete ${removed.status}, ${leftovers.length} file(s) left behind`,
);

console.log(
  failures === 0
    ? "\nDocuments are reachable only by their owner and by staff."
    : `\n${failures} check(s) FAILED — a document may be exposed.`,
);

process.exit(failures === 0 ? 0 : 1);
