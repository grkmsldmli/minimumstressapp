import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const STUBS = "0000_supabase_stubs.sql";
const migrationsDir = join(import.meta.dirname, "migrations");
const MIGRATIONS = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const USER = "11111111-1111-4111-8111-111111111111";
let db: PGlite;

async function preference() {
  return (await db.query<{
    notify_offers: boolean;
    marketing_consent_at: string | null;
    marketing_unsubscribed_at: string | null;
    marketing_consent_source: string | null;
    marketing_unsubscribe_token: string;
  }>(
    `select notify_offers, marketing_consent_at::text, marketing_unsubscribed_at::text,
            marketing_consent_source, marketing_unsubscribe_token::text
       from profiles where id = '${USER}'`,
  )).rows[0];
}

async function asUser(sql: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${USER}', true);
      ${sql}
    `);
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of MIGRATIONS) await db.exec(read(migration));
  await db.exec(`
    insert into auth.users(id, email) values ('${USER}', 'person@example.com');
    insert into profiles(id, display_name) values ('${USER}', 'Morgan');
  `);
}, 60_000);

afterAll(async () => db?.close());

describe("auditable marketing consent", () => {
  it("is default-off with a non-identifying unsubscribe token", async () => {
    const row = await preference();
    expect(row.notify_offers).toBe(false);
    expect(row.marketing_consent_at).toBeNull();
    expect(row.marketing_unsubscribed_at).toBeNull();
    expect(row.marketing_unsubscribe_token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("records an authenticated opt-in and will not accept forged evidence", async () => {
    const before = await preference();
    await asUser(`
      update profiles
      set notify_offers = true,
          marketing_consent_at = '2000-01-01T00:00:00Z',
          marketing_consent_source = 'forged',
          marketing_unsubscribe_token = '99999999-9999-4999-8999-999999999999'
      where id = '${USER}';
    `);

    const row = await preference();
    expect(row.notify_offers).toBe(true);
    expect(row.marketing_consent_at).not.toContain("2000-01-01");
    expect(row.marketing_consent_source).toBe("in_app_settings");
    expect(row.marketing_unsubscribe_token).toBe(before.marketing_unsubscribe_token);
  });

  it("records opt-out while leaving transactional delivery independent", async () => {
    await asUser(`update profiles set notify_offers = false where id = '${USER}';`);
    const row = await preference();

    expect(row.notify_offers).toBe(false);
    expect(row.marketing_consent_at).not.toBeNull();
    expect(row.marketing_unsubscribed_at).not.toBeNull();

    const [{ source }] = (await db.query<{ source: string }>(
      `select pg_get_functiondef(
         'notification_delivery_is_current(text,uuid,text,text,timestamptz,boolean)'::regprocedure
       ) as source`,
    )).rows;
    expect(source).not.toContain("notify_offers");
    expect(source).not.toContain("marketing_");
  });
});
