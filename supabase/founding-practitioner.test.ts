import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FOUNDING_PRACTITIONER_LIMIT } from "../src/lib/founding";

/**
 * Founding Practitioner (migration 0068), run against a real Postgres (PGlite).
 *
 * The status is earned from professional onboarding — a practitioner account, a
 * completed profile, and verified identity + insurance + credential — not from a
 * booking. These are database guarantees (fires on the qualifying profile
 * update; a client completing their own profile as the last step does not trip
 * the server-only guard; permanent; capped at fifty; unique per person; a
 * backfill for those already onboarded), so they are proved by executing the
 * migration rather than reading it.
 */
const STUBS = "0000_supabase_stubs.sql";
const MIG_0068 = "0068_founding_practitioner.sql";
const migrationsDir = join(import.meta.dirname, "migrations");
const MIGRATIONS = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const PRAC = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const result = await db.query<T>(sql, params as never[]);
  return result.rows;
}

/** Run one statement as an authenticated end user, inside a single transaction. */
async function asUser(userId: string, sql: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${userId}', true);
    `);
    await tx.query(sql);
  });
}

/**
 * A practitioner profile, verified except for the fields named in `omit`, so a
 * test can complete the last requirement and watch the award fire. All verdict
 * columns are server-written here (this runs as the owner, auth.uid() null),
 * satisfying the 0054/0058 consistency + date constraints.
 */
function practitioner(
  id: string,
  opts: { profession?: string | null; credential?: string; displayName?: string | null } = {},
): string {
  const profession = opts.profession === undefined ? "'coaching'" : opts.profession === null ? "null" : `'${opts.profession}'`;
  const displayName = opts.displayName === undefined ? "'Elena R.'" : opts.displayName === null ? "null" : `'${opts.displayName}'`;
  const credState = opts.credential ?? "verified";
  const credReviewed = credState === "pending" ? "null" : "now()";
  return `
    insert into auth.users (id, email) values ('${id}', '${id}@e.com');
    insert into profiles (
      id, account_type, display_name, profession,
      identity_verified_at,
      insurance_doc_state, insurance_doc_reviewed_at, insurance_effective_date, insurance_expires_at,
      credential_doc_state, credential_doc_reviewed_at
    ) values (
      '${id}', 'practitioner', ${displayName}, ${profession},
      now(),
      'verified', now(), date '2026-01-01', date '2027-01-01',
      '${credState}', ${credReviewed}
    );`;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of MIGRATIONS) await db.exec(read(migration));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`truncate table auth.users, founding_practitioners cascade;`);
});

describe("earning it from onboarding, not a booking", () => {
  it("does not award until the last requirement is verified", async () => {
    // Everything verified except the credential.
    await db.exec(practitioner(PRAC, { credential: "pending" }));
    let [p] = await rows<{ n: number | null }>(
      `select founding_practitioner_number as n from profiles where id = '${PRAC}'`,
    );
    expect(p.n).toBeNull();

    // Staff verifies the credential — the qualifying update.
    await db.exec(
      `update profiles set credential_doc_state = 'verified', credential_doc_reviewed_at = now() where id = '${PRAC}'`,
    );
    [p] = await rows<{ n: number | null }>(
      `select founding_practitioner_number as n from profiles where id = '${PRAC}'`,
    );
    expect(p.n).toBe(1);
    const [t] = await rows<{ at: string | null }>(
      `select founding_practitioner_at as at from profiles where id = '${PRAC}'`,
    );
    expect(t.at).not.toBeNull();
  });

  it("lets a practitioner complete their own profile as the last step without hitting the server-only guard", async () => {
    // Verdicts all done; only the client-set profession is missing → not yet qualified.
    await db.exec(practitioner(PRAC, { profession: null }));

    // The practitioner sets their profession themselves (auth.uid() = them). The
    // award's nested projection write runs under that same uid — the server-only
    // guard must accept it via the award's transaction-local flag, not refuse it.
    await expect(asUser(PRAC, `update profiles set profession = 'coaching' where id = '${PRAC}'`)).resolves.toBeUndefined();

    const [p] = await rows<{ n: number | null }>(
      `select founding_practitioner_number as n from profiles where id = '${PRAC}'`,
    );
    expect(p.n).toBe(1);
  });

  it("counts a practitioner once, and does not re-award on a later profile edit", async () => {
    await db.exec(practitioner(PRAC, { credential: "pending" }));
    await db.exec(`update profiles set credential_doc_state = 'verified', credential_doc_reviewed_at = now() where id = '${PRAC}'`);
    await db.exec(`update profiles set display_name = 'Elena Rossi' where id = '${PRAC}'`);
    const [{ c }] = await rows<{ c: number }>(`select count(*)::int as c from founding_practitioners`);
    expect(c).toBe(1);
    const [p] = await rows<{ n: number }>(`select founding_practitioner_number as n from profiles where id = '${PRAC}'`);
    expect(p.n).toBe(1);
  });

  it("is permanent — a later revoked document does not remove the number", async () => {
    await db.exec(practitioner(PRAC, { credential: "pending" }));
    await db.exec(`update profiles set credential_doc_state = 'verified', credential_doc_reviewed_at = now() where id = '${PRAC}'`);
    // The credential lapses / is revoked later.
    await db.exec(`update profiles set credential_doc_state = 'rejected', credential_doc_reviewed_at = now() where id = '${PRAC}'`);
    const [p] = await rows<{ n: number | null }>(`select founding_practitioner_number as n from profiles where id = '${PRAC}'`);
    expect(p.n).toBe(1);
  });
});

describe("the guarantees around it", () => {
  it("refuses a signed-in practitioner setting their own founding number", async () => {
    await db.exec(practitioner(PRAC, {}));
    await expect(
      asUser(PRAC, `update profiles set founding_practitioner_number = 1, founding_practitioner_at = now() where id = '${PRAC}'`),
    ).rejects.toThrow();
  });

  it("stops at one hundred — the hundred-and-first onboarded practitioner gets no number", async () => {
    const over = FOUNDING_PRACTITIONER_LIMIT + 1; // 101
    const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    let seed = "";
    for (let i = 1; i <= over; i++) {
      seed += `insert into auth.users (id, email) values ('${id(i)}', '${i}@e.com');`;
      seed += `insert into profiles (id, account_type, display_name) values ('${id(i)}', 'practitioner', 'P${i}');`;
    }
    await db.exec(seed);
    for (let i = 1; i <= over; i++) await db.exec(`select award_founding_practitioner('${id(i)}')`);

    const [{ c }] = await rows<{ c: number }>(`select count(*)::int as c from founding_practitioners`);
    expect(c).toBe(FOUNDING_PRACTITIONER_LIMIT);
    // The hundredth is numbered; the hundred-and-first is not.
    const [hundredth] = await rows<{ n: number | null }>(
      `select founding_practitioner_number as n from profiles where id = '${id(FOUNDING_PRACTITIONER_LIMIT)}'`,
    );
    expect(hundredth.n).toBe(FOUNDING_PRACTITIONER_LIMIT);
    const [last] = await rows<{ n: number | null }>(`select founding_practitioner_number as n from profiles where id = '${id(over)}'`);
    expect(last.n).toBeNull();
    const [{ r }] = await rows<{ r: number }>(`select founding_practitioners_remaining() as r`);
    expect(r).toBe(0);
  });
});

describe("the one-time backfill of practitioners already onboarded", () => {
  /** Apply migrations, injecting seed rows right before 0068 so its backfill sees them. */
  async function withBackfill(seedSql: string): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(read(STUBS));
    for (const m of MIGRATIONS) {
      if (m === MIG_0068) await d.exec(seedSql);
      await d.exec(read(m));
    }
    return d;
  }

  const p = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const qualified = (id: string, credReviewed: string) => `
    insert into auth.users (id, email) values ('${id}', '${id}@e.com');
    insert into profiles (
      id, account_type, display_name, profession,
      identity_verified_at,
      insurance_doc_state, insurance_doc_reviewed_at, insurance_effective_date, insurance_expires_at,
      credential_doc_state, credential_doc_reviewed_at
    ) values (
      '${id}', 'practitioner', 'P', 'coaching',
      timestamptz '2026-01-01',
      'verified', timestamptz '2026-01-01', date '2026-01-01', date '2027-01-01',
      'verified', ${credReviewed}
    );`;

  it("numbers already-onboarded practitioners by when their last requirement landed", async () => {
    // Seeded out of order by the credential-verified moment (the last requirement).
    const seed = `
      ${qualified(p(1), "timestamptz '2026-03-01'")}
      ${qualified(p(2), "timestamptz '2026-01-15'")}
      ${qualified(p(3), "timestamptz '2026-02-01'")}
    `;
    const d = await withBackfill(seed);
    const got = await d.query<{ id: string; founding_practitioner_number: number }>(
      `select id, founding_practitioner_number from profiles where founding_practitioner_number is not null order by founding_practitioner_number`,
    );
    expect(got.rows.map((r) => r.founding_practitioner_number)).toEqual([1, 2, 3]);
    // Earliest last-requirement (p2 Jan 15) is number 1, then p3 (Feb), then p1 (Mar).
    expect(got.rows.map((r) => r.id)).toEqual([p(2), p(3), p(1)]);
    await d.close();
  });

  it("is idempotent — a re-run grants nobody a second number", async () => {
    const d = await withBackfill(qualified(p(1), "timestamptz '2026-01-15'"));
    // Re-run the same backfill CTE the migration ends with; nothing should change.
    await d.exec(read(MIG_0068));
    const [{ c }] = (await d.query<{ c: number }>(`select count(*)::int as c from founding_practitioners`)).rows;
    expect(c).toBe(1);
    await d.close();
  });
});
