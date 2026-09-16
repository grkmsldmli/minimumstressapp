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

const HOST = "11111111-1111-1111-1111-111111111111";
const PRAC = "22222222-2222-2222-2222-222222222222";
const SPACE = "33333333-3333-3333-3333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of MIGRATIONS) await db.exec(read(migration));

  await db.exec(`
    insert into auth.users (id, email) values
      ('${HOST}', 'host@example.com'), ('${PRAC}', 'prac@example.com');
    insert into profiles (id, display_name) values
      ('${HOST}', 'Willow Host'), ('${PRAC}', 'Elena Practitioner');
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${SPACE}', '${HOST}', 'Willow Studio', 'physical', 4500, 3, 'keypad',
      'Panel', '1 Way', 'active', 'space/x/lease.pdf', now(), 'verified', now()
    );
    insert into bookings (
      id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
      host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
      credit_applied_cents, total_cents, platform_cents, status, captured_at,
      approval_state
    ) values (
      '${BOOKING}', '${SPACE}', '${PRAC}', now() - interval '3 hours', now() - interval '2 hours',
      false, false, 4500, 900, 0, 0, 0, 5400, 900, 'completed', now() - interval '4 hours',
      'not_required'
    );
    insert into reviews (booking_id, author_id, subject_id, role, overall, comment)
    values
      ('${BOOKING}', '${PRAC}', '${HOST}', 'practitioner', 5, 'Clean and accurate'),
      ('${BOOKING}', '${HOST}', '${PRAC}', 'host', 5, 'Professional and on time');
  `);
}, 60_000);

afterAll(async () => db?.close());

describe("released review privacy", () => {
  it("publishes room feedback but never the host's private review of the practitioner", async () => {
    const result = await db.transaction(async (tx) => {
      await tx.exec(`
        set local role authenticated;
        select set_config('request.jwt.claim.sub', '${PRAC}', true);
      `);
      return (await tx.query<{ role: string; comment: string }>(
        `select role::text, comment from public_reviews where space_id = '${SPACE}' order by role`,
      )).rows;
    });

    expect(result).toEqual([{ role: "practitioner", comment: "Clean and accurate" }]);
  });
});

describe("review CTA truth and listing contact guard", () => {
  it("returns only the signed-in account's already-reviewed booking ids", async () => {
    for (const user of [HOST, PRAC]) {
      const rows = await db.transaction(async (tx) => {
        await tx.exec(`
          set local role authenticated;
          select set_config('request.jwt.claim.sub', '${user}', true);
        `);
        return (await tx.query<{ booking_id: string }>(`select booking_id::text from reviewed_booking_ids()`)).rows;
      });
      expect(rows).toEqual([{ booking_id: BOOKING }]);
    }
  });

  it("counts received reviews only after the blind boundary releases them", async () => {
    const booking = "55555555-5555-4555-8555-555555555555";
    const review = "66666666-6666-4666-8666-666666666666";
    await db.exec(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents, status, captured_at,
        approval_state
      ) values (
        '${booking}', '${SPACE}', '${PRAC}', now() - interval '2 hours', now() - interval '1 hour',
        false, false, 4500, 900, 0, 0, 0, 5400, 900, 'completed', now() - interval '3 hours',
        'not_required'
      );
      insert into reviews (id, booking_id, author_id, subject_id, role, overall, comment)
      values ('${review}', '${booking}', '${HOST}', '${PRAC}', 'host', 5, 'Reliable');
    `);

    const countAsPractitioner = () =>
      db.transaction(async (tx) => {
        await tx.exec(`
          set local role authenticated;
          select set_config('request.jwt.claim.sub', '${PRAC}', true);
        `);
        return Number((await tx.query<{ count: string }>(
          `select my_released_review_count()::text as count`,
        )).rows[0].count);
      });

    // The already-paired fixture counts; the new lone review must not move it.
    await expect(countAsPractitioner()).resolves.toBe(1);
    await db.exec(`update reviews set created_at = now() - interval '15 days' where id = '${review}'`);
    await expect(countAsPractitioner()).resolves.toBe(2);
  });

  it("rejects contact details in public listing copy but preserves ordinary access instructions", async () => {
    await expect(
      db.exec(`update spaces set description = 'Email me at host@example.com' where id = '${SPACE}'`),
    ).rejects.toThrow(/cannot contain contact details/i);

    await expect(
      db.exec(`update spaces set entry_instructions = 'Use keypad code 4417 at the side door' where id = '${SPACE}'`),
    ).resolves.toBeDefined();
  });
});
