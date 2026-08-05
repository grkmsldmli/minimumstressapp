/**
 * A real signed-in session, without touching the inbox.
 *
 * Verifying anything behind auth used to mean sending myself a code — which
 * redeems the one the person testing was waiting for, and invalidates any code
 * they had already asked for. That happened, and it looked exactly like the
 * app being broken.
 *
 * So this asks the admin API to mint a session directly and prints it as the
 * cookie the browser would have been given anyway. Nothing about the app's own
 * auth path changes; this only skips the delivery of the code.
 *
 *   node scripts/dev-session.mjs you@example.com
 *
 * What it prints is a bearer token — it *is* that account until it expires, so
 * it does not belong in a shell history that gets shared or a terminal on a
 * screen share. It adds no capability, though: it runs on the secret key, and
 * anything holding that key could already sign in as anyone. The account has
 * to exist first, which is the one line that matters — this cannot invent an
 * admin, only borrow one.
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("=");
      return at > 0 && !line.trimStart().startsWith("#")
        ? [line.slice(0, at).trim(), line.slice(at + 1).trim()]
        : null;
    })
    .filter(Boolean),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
const email = process.argv[2] ?? env.ADMIN_EMAILS?.split(",")[0]?.trim();

if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be in .env.local");
  process.exit(1);
}
if (!email) {
  console.error("usage: node scripts/dev-session.mjs you@example.com");
  process.exit(1);
}

const auth = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

/*
 * generateLink hands back the one-time token without mailing it. The account
 * has to exist already — creating one here would mean this script could
 * manufacture an admin, which is not a thing a dev helper should be able to do.
 */
const generated = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ type: "magiclink", email }),
});

if (!generated.ok) {
  console.error(`Could not mint a link for ${email}: ${generated.status}`);
  console.error((await generated.text()).slice(0, 300));
  process.exit(1);
}

const { hashed_token: token } = await generated.json();

const verified = await fetch(`${url}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? secret, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", token_hash: token }),
});

if (!verified.ok) {
  console.error(`Verify failed: ${verified.status}`);
  console.error((await verified.text()).slice(0, 300));
  process.exit(1);
}

const session = await verified.json();

/*
 * The shape @supabase/ssr writes, chunked the way it chunks it — a session is
 * comfortably past the 4 KB a single cookie holds, and a browser silently
 * drops the overflow rather than complaining.
 */
const ref = new URL(url).hostname.split(".")[0];
const name = `sb-${ref}-auth-token`;
const value =
  "base64-" +
  Buffer.from(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  ).toString("base64");

const CHUNK = 3180;
const chunks = [];
for (let at = 0; at < value.length; at += CHUNK) chunks.push(value.slice(at, at + CHUNK));

const cookies =
  chunks.length === 1
    ? [[name, chunks[0]]]
    : chunks.map((chunk, index) => [`${name}.${index}`, chunk]);

console.log(JSON.stringify({ email, user: session.user.id, cookies }, null, 2));
