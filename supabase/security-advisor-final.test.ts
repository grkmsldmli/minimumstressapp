import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "migrations");
const STUBS = "0000_supabase_stubs.sql";
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of migrations) await db.exec(read(migration));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("remaining Supabase Security Advisor warnings", () => {
  it("exposes no SECURITY DEFINER routine directly to anon or authenticated", async () => {
    const result = await db.query<{
      routine: string;
      public_exec: boolean;
      anon_exec: boolean;
      authenticated_exec: boolean;
    }>(`
      select
        p.oid::regprocedure::text as routine,
        has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
      order by routine
    `);

    expect(
      result.rows.filter((r) => r.public_exec || r.anon_exec || r.authenticated_exec),
    ).toEqual([]);
  });

  it("keeps every client-facing privileged RPC as a public SECURITY INVOKER facade", async () => {
    const names = [
      "attribute_referral",
      "founding_hosts_remaining",
      "founding_practitioners_remaining",
      "host_bookings",
      "host_requests",
      "is_booking_participant",
      "mark_messages_read",
      "my_referral_code",
      "my_referral_rewards",
      "my_referrals",
      "space_access_details",
    ];

    const result = await db.query<{ proname: string; prosecdef: boolean }>(`
      select p.proname, p.prosecdef
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(array[${names.map((name) => `'${name}'`).join(",")}])
      order by p.proname
    `);

    expect(new Set(result.rows.map((row) => row.proname))).toEqual(new Set(names));
    expect(result.rows.every((row) => row.prosecdef === false)).toBe(true);
  });

  it("keeps anonymous demand intake without an always-true policy", async () => {
    const policy = await db.query<{ with_check: string | null }>(`
      select with_check
      from pg_policies
      where schemaname = 'public'
        and tablename = 'space_requests'
        and policyname = 'space_requests: anyone may say what they need'
    `);

    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0]?.with_check?.trim().toLowerCase()).not.toBe("true");

    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role anon`);
        await tx.exec(`insert into space_requests (looking_in) values ('San Mateo')`);
      }),
    ).resolves.toBeUndefined();

    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role anon`);
        await tx.exec(`
          insert into space_requests (looking_in, created_at)
          values ('San Mateo', now() - interval '1 day')
        `);
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("keeps avatar delivery public without exposing storage object listing", async () => {
    const buckets = await db.query<{ id: string; public: boolean }>(`
      select id, public
      from storage.buckets
      where id in ('avatars', 'space-media')
      order by id
    `);
    expect(buckets.rows).toEqual([
      { id: "avatars", public: true },
      { id: "space-media", public: false },
    ]);

    const policies = await db.query<{ policyname: string }>(`
      select policyname
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and cmd = 'SELECT'
        and (
          coalesce(qual, '') like '%avatars%'
          or coalesce(qual, '') like '%space-media%'
        )
      order by policyname
    `);

    expect(policies.rows).toEqual([]);
  });
});
