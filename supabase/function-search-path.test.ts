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

describe("public routines pin search_path", () => {
  it("leaves no app-owned public function/procedure with mutable search_path", async () => {
    const result = await db.query<{
      routine: string;
      config: string[] | null;
    }>(`
      select
        p.oid::regprocedure::text as routine,
        p.proconfig as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind in ('f', 'p')
        and not exists (
          select 1
          from pg_depend d
          join pg_extension e on e.oid = d.refobjid
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.refclassid = 'pg_extension'::regclass
            and d.deptype = 'e'
        )
      order by routine
    `);

    const offenders = result.rows.filter(
      ({ config }) => !config?.some((entry) => entry.startsWith("search_path=")),
    );

    expect(offenders).toEqual([]);
  });

  it("uses the trusted app path on routines hardened by 0076", async () => {
    const result = await db.query<{ config: string[] | null }>(`
      select p.proconfig as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'public_area'
      limit 1
    `);

    expect(result.rows[0]?.config).toContain("search_path=public, extensions, pg_temp");
  });
});
