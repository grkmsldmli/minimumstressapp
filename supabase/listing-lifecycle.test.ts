import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "migrations");
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== "0000_supabase_stubs.sql")
  .sort();

let db: PGlite;
const host = "10000000-0000-4000-8000-000000000001";
const otherHost = "10000000-0000-4000-8000-000000000002";
const space = "20000000-0000-4000-8000-000000000001";
const otherSpace = "20000000-0000-4000-8000-000000000002";

async function asHost(sql: string, id = host): Promise<void> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;`);
  try {
    await db.exec(sql);
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("0000_supabase_stubs.sql"));
  for (const migration of migrations) await db.exec(read(migration));

  await db.exec(`
    insert into auth.users (id, email) values
      ('${host}', 'host-one@example.com'),
      ('${otherHost}', 'host-two@example.com');
    insert into profiles (id, display_name, account_type) values
      ('${host}', 'Host One', 'host'),
      ('${otherHost}', 'Host Two', 'host');
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity,
      access_type, entry_instructions, address_line, sublease_doc_path,
      legal_ack_at, status, sublease_doc_state, sublease_doc_reviewed_at
    ) values
      ('${space}', '${host}', 'One', 'physical', 5000, 2, 'keypad', 'Door', '1 Main St', 'lease-one.pdf', now(), 'active', 'verified', now()),
      ('${otherSpace}', '${otherHost}', 'Two', 'physical', 5000, 2, 'keypad', 'Door', '2 Main St', 'lease-two.pdf', now(), 'active', 'verified', now());
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("host listing lifecycle", () => {
  it("lets the owner hide an active listing", async () => {
    await asHost(`update spaces set status = 'delisted' where id = '${space}'`);
    const row = await db.query<{ status: string }>(`select status from spaces where id = '${space}'`);
    expect(row.rows[0].status).toBe("delisted");
  });

  it("lets the owner send a hidden listing back to review", async () => {
    await asHost(`update spaces set status = 'pending' where id = '${space}'`);
    const row = await db.query<{ status: string }>(`select status from spaces where id = '${space}'`);
    expect(row.rows[0].status).toBe("pending");
  });

  it("never lets a host approve their own listing", async () => {
    await expect(asHost(`update spaces set status = 'active' where id = '${space}'`)).rejects.toThrow(
      /status change is not allowed/i,
    );
  });

  it("keeps owner RLS on the lifecycle control", async () => {
    await asHost(`update spaces set status = 'delisted' where id = '${otherSpace}'`);
    const row = await db.query<{ status: string }>(`select status from spaces where id = '${otherSpace}'`);
    expect(row.rows[0].status).toBe("active");
  });
});
