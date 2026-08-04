import { readFileSync } from "node:fs";

/**
 * Registers the sending domain with Resend and prints the DNS records it wants,
 * formatted for the box you actually type them into.
 *
 * Two things make this worth a script rather than a copy from the dashboard.
 * Registrars ask for the *host* — the part before the domain — while providers
 * quote the fully qualified name, and pasting the full name into GoDaddy
 * silently creates `send.minimumstress.app.minimumstress.app`. And re-running
 * this re-checks verification, so there is a way to see whether DNS has
 * propagated without clicking around.
 *
 *   node scripts/resend-domain.mjs minimumstress.app
 *   node scripts/resend-domain.mjs minimumstress.app --verify
 */

const domain = process.argv[2];
const verifyNow = process.argv.includes("--verify");

if (!domain) {
  console.error("Usage: node scripts/resend-domain.mjs minimumstress.app [--verify]");
  process.exit(1);
}

const key = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("RESEND_API_KEY="))
  ?.slice("RESEND_API_KEY=".length)
  .trim();

if (!key || key.startsWith("BURAYA")) {
  console.error("RESEND_API_KEY is not set in .env.local");
  process.exit(1);
}

async function resend(path, init = {}) {
  const response = await fetch(`https://api.resend.com/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));

  /**
   * The app's key is sending-only, which is the right scope for it — a key
   * that lives in a deployed environment should not be able to reconfigure
   * the account. So this is an expected outcome rather than a bug, and it
   * deserves the instructions instead of a stack trace.
   */
  if (response.status === 401 || /restricted/i.test(payload.message ?? "")) {
    console.error(
      [
        "This RESEND_API_KEY can only send email, so it cannot manage domains.",
        "",
        "That is the correct scope for the app's key — do not widen it. Add the",
        "domain in the Resend dashboard instead: Domains → Add Domain.",
        "",
        "Resend will show a set of DNS records. When you copy them into GoDaddy,",
        "put only the part *before* the domain in the Name box — `send` rather",
        "than `send.minimumstress.app`, and `@` for the domain itself. GoDaddy",
        "appends the domain for you, and pasting the full name produces",
        "send.minimumstress.app.minimumstress.app, which never verifies.",
      ].join("\n"),
    );
    process.exit(2);
  }

  if (!response.ok) {
    console.error(`Resend refused: ${payload.message ?? response.status}`);
    process.exit(1);
  }

  return payload;
}

const existing = await resend("domains");
let record = existing.data?.find((d) => d.name === domain);

if (!record) {
  record = await resend("domains", { method: "POST", body: JSON.stringify({ name: domain }) });
  console.log(`Registered ${domain} with Resend (${record.id})\n`);
} else {
  console.log(`${domain} is already registered with Resend (${record.id})\n`);
}

if (verifyNow) {
  await resend(`domains/${record.id}/verify`, { method: "POST" });
  console.log("Asked Resend to re-check DNS.\n");
}

const detail = await resend(`domains/${record.id}`);

console.log(`Status: ${detail.status}\n`);

/** GoDaddy wants the host, not the fully qualified name. */
function hostOf(name) {
  if (name === domain) return "@";
  return name.endsWith(`.${domain}`) ? name.slice(0, -(domain.length + 1)) : name;
}

console.log("Add these in GoDaddy → Domains → minimumstress.app → DNS:\n");

for (const dns of detail.records ?? []) {
  console.log(`  Type:  ${dns.type}`);
  console.log(`  Name:  ${hostOf(dns.name)}`);
  console.log(`  Value: ${dns.value}`);
  if (dns.priority !== undefined && dns.priority !== null) console.log(`  Priority: ${dns.priority}`);
  console.log(`  (status: ${dns.status})\n`);
}

if (detail.status !== "verified") {
  console.log("Once they are saved, run this again with --verify.");
  console.log("DNS usually takes a few minutes; GoDaddy can take up to an hour.");
}
