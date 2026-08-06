import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migrations applied to a database that already has rows in it.
 *
 * The other suite applies every migration to an empty database and asserts the
 * shape that comes out. That is a real test and it passes, and it let a
 * migration through that failed on the first production database it met.
 *
 * 0018 added `spaces_active_requires_verified_lease` and then backfilled the
 * column it checks. On an empty table `ALTER TABLE ... ADD CONSTRAINT` has
 * nothing to validate, so the order never mattered; on a database with a live
 * listing in it, the constraint judged that row against a column created one
 * statement earlier, which still said 'pending' for everything. It failed
 * having passed every test.
 *
 * So this suite does what the other one cannot: it stops partway, puts real
 * rows in, and then applies the rest. That is the shape of every upgrade after
 * the first one, and it is the only place an ordering bug like that is
 * visible.
 */

const migrationsDir = join(import.meta.dirname, "migrations");
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

/**
 * What Supabase provides, from the file the other suites read.
 *
 * Written out a second time here to begin with, which is how two copies of a
 * platform stub start disagreeing about what the platform is.
 */
const STUBS = "0000_supabase_stubs.sql";

const ALL = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();

/**
 * The last migration that existed before the ones under test.
 *
 * Held as a name rather than a count so that adding a migration does not
 * silently change which half of the split this suite is testing.
 */
const LAST_SHIPPED = "0017_storage_paths_by_owner.sql";

const HOST = "11111111-1111-1111-1111-111111111111";
const SPACE = "44444444-4444-4444-4444-444444444444";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));

  const shippedUpTo = ALL.indexOf(LAST_SHIPPED);
  expect(shippedUpTo, `${LAST_SHIPPED} is missing from migrations/`).toBeGreaterThan(-1);

  for (const file of ALL.slice(0, shippedUpTo + 1)) {
    await db.exec(read(file));
  }

  // A marketplace in the state a real one is in before an upgrade: an account,
  // a live listing that somebody reviewed by hand, and one waiting.
  await db.exec(`
    insert into auth.users (id, email) values ('${HOST}', 'host@example.com');
    insert into profiles (id, display_name) values ('${HOST}', 'Willow Studio');

    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at
    ) values
      ('${SPACE}', '${HOST}', 'Willow', 'physical', 4500, 3, 'keypad',
       'Panel by the blue door', '12 Alder Lane', 'active',
       'space/x/lease.pdf', now()),
      ('55555555-5555-5555-5555-555555555555', '${HOST}', 'Not Yet Live', 'spirit',
       2600, 6, 'lockbox', 'Lockbox under the bench', '9 Hidden Way', 'pending',
       'space/y/lease.pdf', now());
  `);

  for (const file of ALL.slice(shippedUpTo + 1)) {
    await db.exec(read(file));
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("upgrading a database that is already in use", () => {
  it("applies every migration over existing rows", async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from spaces`);
    expect(rows[0].n).toBe(2);
  });

  /**
   * The listing was live because a person had approved it. Dropping it back
   * into the review queue would ask a host to prove something they already
   * proved, and take their room off search while they did.
   */
  it("records listings that were already live as verified", async () => {
    const { rows } = await db.query<{ status: string; sublease_doc_state: string }>(
      `select status, sublease_doc_state from spaces where id = '${SPACE}'`,
    );
    expect(rows[0].status).toBe("active");
    expect(rows[0].sublease_doc_state).toBe("verified");
  });

  it("leaves listings that were waiting still waiting", async () => {
    const { rows } = await db.query<{ sublease_doc_state: string; reviewed: string | null }>(
      `select sublease_doc_state, sublease_doc_reviewed_at as reviewed
         from spaces where status = 'pending'`,
    );
    expect(rows[0].sublease_doc_state).toBe("pending");
    expect(rows[0].reviewed).toBeNull();
  });

  it("enforces the rule once the existing rows have been recorded", async () => {
    await expect(
      db.exec(`
        insert into spaces (
          host_id, name, category, hourly_rate_cents, capacity, access_type,
          entry_instructions, address_line, status, sublease_doc_path, legal_ack_at
        ) values (
          '${HOST}', 'Sneaked Live', 'physical', 4000, 2, 'keypad',
          'x', '1 Nowhere', 'active', 'space/z/lease.pdf', now()
        );
      `),
    ).rejects.toThrow(/verified_lease/i);
  });

  /**
   * Nobody agreed to terms that did not exist when they signed up, and
   * recording that they did would make the one field whose whole value is
   * being true into a lie.
   */
  it("does not invent a terms acceptance for accounts that predate them", async () => {
    const { rows } = await db.query<{ terms_version: number | null }>(
      `select terms_version from profiles where id = '${HOST}'`,
    );
    expect(rows[0].terms_version).toBeNull();
  });

  it("survives the upgrade being applied a second time", async () => {
    const shippedUpTo = ALL.indexOf(LAST_SHIPPED);
    for (const file of ALL.slice(shippedUpTo + 1)) {
      await db.exec(read(file));
    }

    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from spaces`);
    expect(rows[0].n).toBe(2);
  });
});
