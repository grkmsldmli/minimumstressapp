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

function hasDirectAuthHelper(expr: string | null): boolean {
  if (!expr) return false;

  // Remove the scalar-SELECT form first. Any helper call left afterwards is a
  // per-row call and would trigger Supabase's Auth RLS Initialization Plan
  // warning. PGlite/Postgres may add an alias while deparsing the subquery.
  const withoutInitPlans = expr.replace(
    /\(\s*select\s+auth\.(?:uid|jwt|role)\(\)(?:\s+as\s+[a-z_][a-z0-9_]*)?\s*\)/gi,
    "",
  );
  return /auth\.(?:uid|jwt|role)\(\)/i.test(withoutInitPlans);
}

describe("RLS auth helpers are query InitPlans", () => {
  it("has no direct auth.uid/auth.jwt/auth.role call in an exposed policy", async () => {
    const result = await db.query<{
      schemaname: string;
      tablename: string;
      policyname: string;
      qual: string | null;
      with_check: string | null;
    }>(`
      select schemaname, tablename, policyname, qual, with_check
      from pg_policies
      where schemaname in ('public', 'storage')
      order by schemaname, tablename, policyname
    `);

    const offenders = result.rows.filter(
      (policy) => hasDirectAuthHelper(policy.qual) || hasDirectAuthHelper(policy.with_check),
    );

    expect(offenders).toEqual([]);
  });
});
