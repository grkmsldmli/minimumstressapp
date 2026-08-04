import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the migrations against a real Postgres (PGlite, compiled to WASM) so
 * the DDL is executed rather than eyeballed. There is no live Supabase project
 * yet, and a schema that only looks right is not worth much when the first
 * thing it does in production is take money.
 *
 * `0000_supabase_stubs.sql` stands in for what Supabase provides — auth.users,
 * storage.*, auth.uid() — and is deliberately excluded from MIGRATIONS so it
 * can never be mistaken for something to apply to the real project.
 */
const MIGRATIONS = [
  "0001_schema.sql",
  "0002_rls.sql",
  "0003_storage.sql",
  "0004_narrow_public_profiles.sql",
  "0005_host_bookings.sql",
  "0006_service_role_grants.sql",
  "0007_space_details.sql",
];
const STUBS = "0000_supabase_stubs.sql";

const migrationsDir = join(import.meta.dirname, "migrations");
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of MIGRATIONS) {
    await db.exec(read(migration));
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const result = await db.query<T>(sql, params as never[]);
  return result.rows;
}

describe("migrations apply cleanly", () => {
  it("survives being applied a second time", async () => {
    /**
     * Pasting the whole script into a project that already has most of it
     * should be dull. Before this, it aborted on `create type space_category`
     * at line 16 and left the operator guessing which half had landed —
     * which is exactly what happened in practice.
     */
    const fresh = new PGlite();
    try {
      await fresh.exec(read(STUBS));
      for (const migration of MIGRATIONS) await fresh.exec(read(migration));
      for (const migration of MIGRATIONS) await fresh.exec(read(migration));

      const tables = await fresh.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      expect(tables.rows).toHaveLength(6);
    } finally {
      await fresh.close();
    }
  }, 60_000);

  it("creates every table the app expects", async () => {
    const found = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );

    expect(found.map((r) => r.table_name)).toEqual([
      "availability",
      "bookings",
      "credit_ledger",
      "profiles",
      "space_media",
      "spaces",
    ]);
  });

  it("grants service_role access to every table the server writes", async () => {
    /**
     * This is the check that was missing. A policy without a GRANT is dead
     * code, and BYPASSRLS does not help a role that cannot touch the table at
     * all — service_role authenticated perfectly while every REST call came
     * back denied, which reads exactly like a bad key.
     */
    const ungranted = await rows<{ table_name: string }>(
      `select t.table_name
       from information_schema.tables t
       where t.table_schema = 'public'
         and t.table_type = 'BASE TABLE'
         and not exists (
           select 1 from information_schema.role_table_grants g
           where g.table_schema = 'public'
             and g.table_name = t.table_name
             and g.grantee = 'service_role'
             and g.privilege_type = 'INSERT'
         )
       order by t.table_name`,
    );

    expect(ungranted).toEqual([]);
  });

  it("still refuses anon everything on the base tables", async () => {
    // Widening service_role must not have widened anon along with it.
    const granted = await rows<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
         and table_name in ('profiles','spaces','bookings','credit_ledger','availability','space_media')`,
    );

    expect(granted).toEqual([]);
  });

  it("enables row level security on every table", async () => {
    const unprotected = await rows<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and rowsecurity = false`,
    );

    expect(unprotected).toEqual([]);
  });
});

describe("private columns stay out of the public views", () => {
  /** The whole address-privacy rule rests on these columns being absent. */
  it("omits address and entry instructions from spaces_public", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'spaces_public'`,
    );
    const names = columns.map((c) => c.column_name);

    expect(names).not.toContain("address_line");
    expect(names).not.toContain("lat");
    expect(names).not.toContain("lng");
    expect(names).not.toContain("entry_instructions");
    expect(names).not.toContain("sublease_doc_path");
    expect(names).not.toContain("insurance_doc_path");

    // Still has to be useful for Discover.
    expect(names).toContain("hourly_rate_cents");
    expect(names).toContain("category");

    // House rules are shown before booking, not after. A grip-socks
    // requirement discovered on arrival is the same broken promise as a fee
    // that appears at checkout.
    expect(names).toContain("requirements");
    expect(names).toContain("house_rules");
  });

  it("omits Stripe identifiers and document paths from public_host_profiles", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'public_host_profiles'`,
    );

    expect(columns.map((c) => c.column_name).sort()).toEqual([
      "avatar_path",
      "display_name",
      "id",
    ]);
  });

  it("runs per-user views as the caller and public views as the definer", async () => {
    // Both halves matter. A per-user view without security_invoker bypasses
    // RLS and hands every practitioner's balance to whoever asks. A public
    // subset view *with* it errors instead, because anon holds no grant on
    // the base table — safety there comes from the column list, not from RLS.
    const PER_USER = ["credit_balances", "bookings_with_access_code"];
    const PUBLIC = [
      "spaces_public",
      "public_host_profiles",
      "availability_public",
      "space_media_public",
    ];

    const views = await rows<{ viewname: string; options: string[] | null }>(
      `select c.relname as viewname, c.reloptions as options
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'`,
    );
    const optionsFor = (name: string) =>
      views.find((v) => v.viewname === name)?.options ?? [];

    expect(views.map((v) => v.viewname).sort()).toEqual([...PER_USER, ...PUBLIC].sort());

    for (const name of PER_USER) {
      expect(optionsFor(name), `${name} must be security_invoker`).toContain(
        "security_invoker=true",
      );
    }
    for (const name of PUBLIC) {
      expect(optionsFor(name), `${name} must not be security_invoker`).not.toContain(
        "security_invoker=true",
      );
    }
  });

  it("exposes the address only through a security definer function", async () => {
    const [fn] = await rows<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'space_access_details'`,
    );

    expect(fn.prosecdef).toBe(true);
    // A definer function without a pinned search_path is a privilege
    // escalation waiting to happen.
    expect(fn.proconfig ?? []).toContain("search_path=public");
  });
});

describe("money and scheduling constraints", () => {
  const aUser = "11111111-1111-1111-1111-111111111111";

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${aUser}', 'host@example.com');
      insert into profiles (id, display_name) values ('${aUser}', 'Test Host');
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity,
        access_type, entry_instructions, address_line, sublease_doc_path, legal_ack_at
      ) values (
        '22222222-2222-2222-2222-222222222222', '${aUser}', 'Willow', 'physical',
        4500, 3, 'keypad', 'Code is on the door panel', '1 Test St', 'space/x/lease.pdf', now()
      );
    `);
  });

  it("rejects a zero or negative hourly rate", async () => {
    await expect(
      db.exec(`
        insert into spaces (
          host_id, name, category, hourly_rate_cents, capacity,
          access_type, entry_instructions, address_line, sublease_doc_path, legal_ack_at
        ) values (
          '${aUser}', 'Free room', 'physical', 0, 2,
          'keypad', 'n/a', '2 Test St', 'space/x/lease.pdf', now()
        );
      `),
    ).rejects.toThrow();
  });

  it("rejects an availability block that ends before it starts", async () => {
    await expect(
      db.exec(`
        insert into availability (space_id, weekday, start_minute, end_minute)
        values ('22222222-2222-2222-2222-222222222222', 1, 1020, 540);
      `),
    ).rejects.toThrow();
  });

  it("accepts several blocks on the same weekday", async () => {
    // The brief's own example: Monday 7-8am, 2-3pm and 5-9pm.
    await db.exec(`
      insert into availability (space_id, weekday, start_minute, end_minute) values
        ('22222222-2222-2222-2222-222222222222', 1, 420, 480),
        ('22222222-2222-2222-2222-222222222222', 1, 840, 900),
        ('22222222-2222-2222-2222-222222222222', 1, 1020, 1260);
    `);

    const monday = await rows(
      `select start_minute from availability
       where space_id = '22222222-2222-2222-2222-222222222222' and weekday = 1
       order by start_minute`,
    );

    expect(monday).toHaveLength(3);
  });

  it("rejects a booking that ends before it starts", async () => {
    await expect(
      db.exec(`
        insert into bookings (
          space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
          host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
          credit_applied_cents, total_cents, platform_cents
        ) values (
          '22222222-2222-2222-2222-222222222222', '${aUser}',
          now() + interval '2 hours', now() + interval '1 hour',
          false, false, 4500, 900, 0, 0, 0, 5400, 900
        );
      `),
    ).rejects.toThrow();
  });

  it("rejects a half-recorded cancellation", async () => {
    // cancelled_at without cancelled_by would leave us unable to tell whether
    // the practitioner or the host walked away, which decides who gets charged.
    await expect(
      db.exec(`
        insert into bookings (
          space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
          host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
          credit_applied_cents, total_cents, platform_cents, cancelled_at
        ) values (
          '22222222-2222-2222-2222-222222222222', '${aUser}',
          now() + interval '1 hour', now() + interval '2 hours',
          false, false, 4500, 900, 0, 0, 0, 5400, 900, now()
        );
      `),
    ).rejects.toThrow();
  });

  it("refuses to delete a space that has bookings against it", async () => {
    await db.exec(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents
      ) values (
        '33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', '${aUser}',
        now() + interval '1 hour', now() + interval '2 hours',
        false, false, 4500, 900, 0, 0, 0, 5400, 900
      );
    `);

    await expect(
      db.exec(`delete from spaces where id = '22222222-2222-2222-2222-222222222222';`),
    ).rejects.toThrow();
  });

  it("derives the credit balance as a sum of deltas", async () => {
    await db.exec(`
      insert into credit_ledger (practitioner_id, delta_cents, reason) values
        ('${aUser}', 900, 'host_cancellation'),
        ('${aUser}', -734, 'booking_redemption'),
        ('${aUser}', 166, 'host_cancellation');
    `);

    const [balance] = await rows<{ balance_cents: number }>(
      `select balance_cents from credit_balances where practitioner_id = '${aUser}'`,
    );

    expect(balance.balance_cents).toBe(332);
  });
});
