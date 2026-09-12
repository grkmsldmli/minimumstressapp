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

describe("Security Advisor definer diagnostic", () => {
  it("prints exposed SECURITY DEFINER routines", async () => {
    const result = await db.query<{
      routine: string;
      public_exec: boolean;
      anon_exec: boolean;
      authenticated_exec: boolean;
      service_exec: boolean;
      trigger_refs: number;
    }>(`
      select
        p.oid::regprocedure::text as routine,
        has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
        (select count(*)::int from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal) as trigger_refs
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
      order by routine
    `);

    const exposed = result.rows.filter(
      (r) => r.public_exec || r.anon_exec || r.authenticated_exec,
    );

    expect(exposed).toEqual([]);
  });
});
