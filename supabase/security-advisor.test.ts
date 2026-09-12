import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const STUBS = "0000_supabase_stubs.sql";
const migrationsDir = join(import.meta.dirname, "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const EXPOSED_VIEWS = [
  "availability_public",
  "space_ratings",
  "public_reviews",
  "session_counts",
  "city_inventory",
  "city_type_inventory",
  "space_demand",
  "spaces_public",
  "public_host_profiles",
  "city_category_inventory",
  "space_media_public",
] as const;

const ANON_VIEWS = new Set([
  "city_inventory",
  "city_type_inventory",
  "city_category_inventory",
  "space_demand",
]);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of migrations) await db.exec(read(migration));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("Security Advisor exposed-view boundary", () => {
  it("keeps every Data API view SECURITY INVOKER", async () => {
    const result = await db.query<{ relname: string; reloptions: string[] | null }>(`
      select c.relname, c.reloptions
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'v'
        and c.relname = any(array[${EXPOSED_VIEWS.map((v) => `'${v}'`).join(",")}])
      order by c.relname
    `);

    expect(result.rows).toHaveLength(EXPOSED_VIEWS.length);
    for (const row of result.rows) {
      expect(row.reloptions ?? []).toContain("security_invoker=true");
    }
  });

  it("moves the privileged implementations out of public", async () => {
    const result = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private'
        and c.relkind = 'v'
        and c.relname like '_ms_%_definer'
      order by c.relname
    `);

    expect(result.rows.map((row) => row.relname)).toHaveLength(EXPOSED_VIEWS.length);
    for (const view of EXPOSED_VIEWS) {
      expect(result.rows.map((row) => row.relname)).toContain(`_ms_${view}_definer`);
    }
  });

  it("preserves the intended anon boundary", async () => {
    for (const view of EXPOSED_VIEWS) {
      const result = await db.query<{ allowed: boolean }>(
        `select has_table_privilege('anon', $1, 'select') as allowed`,
        [`public.${view}`],
      );
      expect(Boolean(result.rows[0]?.allowed)).toBe(ANON_VIEWS.has(view));
    }
  });

  it("keeps every public facade readable by authenticated users", async () => {
    for (const view of EXPOSED_VIEWS) {
      const result = await db.query<{ allowed: boolean }>(
        `select has_table_privilege('authenticated', $1, 'select') as allowed`,
        [`public.${view}`],
      );
      expect(Boolean(result.rows[0]?.allowed)).toBe(true);
    }
  });
});
