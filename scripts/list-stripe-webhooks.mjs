import { readFileSync } from "node:fs";

/** Shows every webhook endpoint with the fields that decide what it receives. */

const key = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("STRIPE_SECRET_KEY="))
  ?.slice("STRIPE_SECRET_KEY=".length)
  .trim();

const response = await fetch("https://api.stripe.com/v1/webhook_endpoints?limit=100", {
  headers: { Authorization: `Bearer ${key}` },
});
const { data, error } = await response.json();

if (error) {
  console.error(error.message);
  process.exit(1);
}

for (const endpoint of data) {
  console.log(`${endpoint.id}`);
  console.log(`  description: ${endpoint.description}`);
  console.log(`  url:         ${endpoint.url}`);
  console.log(`  status:      ${endpoint.status}`);
  console.log(`  connect:     ${JSON.stringify(endpoint.connect)}`);
  console.log(`  application: ${JSON.stringify(endpoint.application)}`);
  console.log(`  events:      ${endpoint.enabled_events.join(", ")}`);
  console.log();
}
