import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The referral reward ledger, against a real Postgres (PGlite).
 *
 * A reward is money, so it is proved by executing migration 0062 rather than
 * read: exactly one $25 per qualified referral, created only at the authoritative
 * qualified moment, never forgeable or alterable by a client, and summed from
 * real rows. No payout moves here.
 */
const STUBS = "0000_supabase_stubs.sql";
const migrationsDir = join(import.meta.dirname, "migrations");
const MIGRATIONS = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const REFERRER = "11111111-1111-1111-1111-111111111111";
const HOST = "22222222-2222-2222-2222-222222222222";
const PRAC = "33333333-3333-3333-3333-333333333333";
const CODE = "REF00001";
const SPACE = "44444444-4444-4444-4444-444444444444";

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never[])).rows;
}

async function asRole<T = Record<string, unknown>>(
  role: "authenticated" | "anon",
  userId: string,
  sql: string,
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`
      set local role ${role};
      select set_config('request.jwt.claim.sub', '${userId}', true);
    `);
    return (await tx.query<T>(sql)).rows;
  }) as Promise<T[]>;
}

const attributeAs = (userId: string, code: string) =>
  asRole("authenticated", userId, `select attribute_referral('${code}')`);

function pendingSpace(id: string, host: string): string {
  return `
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${id}', '${host}', 'Room', 'physical', 4500, 3, 'keypad',
      'Panel', '1 Way', 'pending', 'space/x/lease.pdf', now(), 'pending', null
    );`;
}

const approve = (id: string) =>
  rows(`update spaces set status = 'active', sublease_doc_state = 'verified',
          sublease_doc_reviewed_at = now()
        where id = '${id}' and status = 'pending'`);

function insertBooking(id: string, status: string, captured: string, space = SPACE): string {
  return `
    insert into bookings (
      id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
      host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
      credit_applied_cents, total_cents, platform_cents, status, captured_at
    ) values (
      '${id}', '${space}', '${PRAC}', now() - interval '2 hours', now() - interval '1 hour',
      false, false, 4500, 900, 0, 0, 0, 5400, 900, '${status}', ${captured}
    );`;
}

/** Bring the referred HOST all the way to a qualified referral. */
async function qualifyHost(bookingId = "b0000000-0000-4000-8000-000000000001"): Promise<void> {
  await attributeAs(HOST, CODE);
  await rows(pendingSpace(SPACE, HOST));
  await approve(SPACE);
  await rows(insertBooking(bookingId, "upcoming", "now()"));
  await rows(`update bookings set status = 'completed' where id = '${bookingId}'`);
}

/**
 * Model production account deletion (lib/account-deletion): the auth user is
 * deleted, but the scrubbed profile row is deliberately RETAINED as a
 * foreign-key target for financial history. session_replication_role = replica
 * removes the auth row without cascading the profile, reproducing that state.
 */
const deleteAccount = (userId: string) =>
  db.exec(`
    set session_replication_role = replica;
    delete from auth.users where id = '${userId}';
    set session_replication_role = default;
  `);

const rewardsOf = (referrer: string) =>
  rows<{ referral_id: string; amount_cents: number; payout_state: string; referrer_id: string }>(
    `select referral_id::text, amount_cents, payout_state, referrer_id::text
     from referral_rewards where referrer_id = '${referrer}'`,
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const m of MIGRATIONS) await db.exec(read(m));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`
    truncate table auth.users, referrals, referrer_codes, referral_rewards cascade;
    insert into auth.users (id, email) values
      ('${REFERRER}', 'referrer@example.com'),
      ('${HOST}', 'host@example.com'),
      ('${PRAC}', 'prac@example.com');
    insert into profiles (id, display_name) values
      ('${REFERRER}', 'Referrer'),
      ('${HOST}', 'Brought Host'),
      ('${PRAC}', 'Practitioner');
    insert into referrer_codes (host_id, code) values ('${REFERRER}', '${CODE}');
  `);
});

describe("a reward exists only once a referral is qualified", () => {
  it("a joined referral earns nothing", async () => {
    await attributeAs(HOST, CODE);
    expect(await rewardsOf(REFERRER)).toHaveLength(0);
  });

  it("a space-live referral earns nothing", async () => {
    await attributeAs(HOST, CODE);
    await rows(pendingSpace(SPACE, HOST));
    await approve(SPACE);
    // listing live, but no completed booking yet
    expect(await rewardsOf(REFERRER)).toHaveLength(0);
  });

  it("a qualified referral creates exactly one $25 reward, earned", async () => {
    await qualifyHost();
    const r = await rewardsOf(REFERRER);
    expect(r).toHaveLength(1);
    expect(r[0].amount_cents).toBe(2500);
    expect(r[0].payout_state).toBe("earned");
    expect(r[0].referrer_id).toBe(REFERRER);

    // It is anchored to the referral's own stable id.
    const [ref] = await rows<{ id: string }>(
      `select id::text from referrals where referred_host_id = '${HOST}'`,
    );
    expect(r[0].referral_id).toBe(ref.id);
  });
});

describe("no duplicate reward, ever", () => {
  it("a second, later booking creates no additional reward", async () => {
    await qualifyHost("b1000000-0000-4000-8000-000000000001");
    const second = "b1000000-0000-4000-8000-000000000002";
    await rows(insertBooking(second, "upcoming", "now()"));
    await rows(`update bookings set status = 'completed' where id = '${second}'`);
    expect(await rewardsOf(REFERRER)).toHaveLength(1);
  });

  it("a repeated qualified-state write creates no duplicate", async () => {
    await qualifyHost();
    // Force the referral's qualified_at to be re-written to a new value; the
    // reward trigger fires only on the null -> not null transition, and the
    // unique constraint would refuse a duplicate regardless.
    await rows(
      `update referrals set qualified_at = now() where referred_host_id = '${HOST}'`,
    );
    expect(await rewardsOf(REFERRER)).toHaveLength(1);
  });

  it("two qualified referrals total exactly $50", async () => {
    await qualifyHost();

    // A second brought host, brought by the same referrer, also qualifies.
    const host2 = "22222222-2222-2222-2222-222222222223";
    const space2 = "44444444-4444-4444-4444-444444444402";
    await rows(`insert into auth.users (id, email) values ('${host2}', 'h2@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${host2}', 'H2')`);
    await asRole("authenticated", host2, `select attribute_referral('${CODE}')`);
    await rows(pendingSpace(space2, host2));
    await approve(space2);
    const b2 = "b2000000-0000-4000-8000-000000000001";
    await rows(insertBooking(b2, "upcoming", "now()", space2));
    await rows(`update bookings set status = 'completed' where id = '${b2}'`);

    const [{ total }] = await rows<{ total: number }>(
      `select coalesce(sum(amount_cents), 0)::int as total
       from referral_rewards where referrer_id = '${REFERRER}'`,
    );
    expect(total).toBe(5000);
    expect(await rewardsOf(REFERRER)).toHaveLength(2);
  });
});

describe("the reward ledger is the server's alone", () => {
  it("a client cannot read, forge, alter, or delete a reward", async () => {
    await qualifyHost();
    await expect(asRole("authenticated", REFERRER, `select * from referral_rewards`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asRole(
        "authenticated",
        REFERRER,
        `insert into referral_rewards (referral_id, referrer_id, amount_cents)
         values (gen_random_uuid(), '${REFERRER}', 999999)`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("authenticated", REFERRER, `update referral_rewards set amount_cents = 999999`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("authenticated", REFERRER, `delete from referral_rewards`),
    ).rejects.toThrow(/permission denied/i);

    // Untouched by all of that.
    const r = await rewardsOf(REFERRER);
    expect(r).toHaveLength(1);
    expect(r[0].amount_cents).toBe(2500);
  });

  it("shows a referrer only their own rewards through the safe reader", async () => {
    await qualifyHost();
    const [ref] = await rows<{ id: string }>(
      `select id::text from referrals where referred_host_id = '${HOST}'`,
    );
    const seen = await asRole<{ referral_id: string; amount_cents: number; payout_state: string }>(
      "authenticated",
      REFERRER,
      `select * from my_referral_rewards()`,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].referral_id).toBe(ref.id);
    expect(seen[0].amount_cents).toBe(2500);
    expect(seen[0].payout_state).toBe("earned");

    // Another account sees none of it.
    const other = await asRole("authenticated", PRAC, `select * from my_referral_rewards()`);
    expect(other).toHaveLength(0);
  });
});

describe("rewards do not disturb bookings, and survive account deletion", () => {
  it("leaves the qualifying booking's accounting untouched", async () => {
    const bookingId = "b3000000-0000-4000-8000-000000000001";
    await qualifyHost(bookingId);
    const [b] = await rows<{
      status: string;
      captured_at: string | null;
      host_rate_cents: number;
      total_cents: number;
      host_paid_at: string | null;
    }>(
      `select status::text, captured_at, host_rate_cents, total_cents, host_paid_at
       from bookings where id = '${bookingId}'`,
    );
    expect(b.status).toBe("completed");
    expect(b.captured_at).not.toBeNull();
    expect(b.host_rate_cents).toBe(4500);
    expect(b.total_cents).toBe(5400);
    // The reward touched no payout field on the booking.
    expect(b.host_paid_at).toBeNull();
  });

  it("survives the referrer deleting their account, and does not block it", async () => {
    await qualifyHost();

    // The referrer deletes their account through the existing semantics: the auth
    // user goes, the scrubbed profile is kept.
    await deleteAccount(REFERRER);

    expect(await rows(`select 1 from auth.users where id = '${REFERRER}'`)).toHaveLength(0);
    expect(await rows(`select 1 from profiles where id = '${REFERRER}'`)).toHaveLength(1);

    // The reward — a financial record — is retained, pointing at the kept profile.
    const r = await rewardsOf(REFERRER);
    expect(r).toHaveLength(1);
    expect(r[0].amount_cents).toBe(2500);
  });
});

describe("a deleted referrer earns nothing (account existence is auth.users)", () => {
  it("does not reward a referrer whose account was deleted before qualification", async () => {
    await attributeAs(HOST, CODE);
    await rows(pendingSpace(SPACE, HOST));
    await approve(SPACE);

    // Referrer deletes their account before the referred host's first session.
    await deleteAccount(REFERRER);
    // The scrubbed profile is still there — the old, wrong check would see it.
    expect(await rows(`select 1 from profiles where id = '${REFERRER}'`)).toHaveLength(1);

    // The referral still qualifies on the completed, captured booking...
    const b = "b4000000-0000-4000-8000-000000000001";
    await rows(insertBooking(b, "upcoming", "now()"));
    await rows(`update bookings set status = 'completed' where id = '${b}'`);
    const [ref] = await rows<{ qualified_at: string | null }>(
      `select qualified_at from referrals where referred_host_id = '${HOST}'`,
    );
    expect(ref.qualified_at).not.toBeNull();

    // ...but no reward is minted for the departed referrer.
    expect(await rewardsOf(REFERRER)).toHaveLength(0);
  });
});

describe("backfill for referrals already qualified", () => {
  async function withBackfill(seedSql: string): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(read(STUBS));
    for (const m of MIGRATIONS) {
      if (m === "0062_referral_rewards.sql") await d.exec(seedSql);
      await d.exec(read(m));
    }
    return d;
  }

  // A referrer, an already-qualified referral, and a not-yet-qualified one,
  // seeded directly before 0062 runs.
  const seed = `
    insert into auth.users (id, email) values
      ('${REFERRER}', 'r@e.com'), ('${HOST}', 'h@e.com'),
      ('aaaaaaaa-0000-4000-8000-000000000001', 'q@e.com'),
      ('aaaaaaaa-0000-4000-8000-000000000002', 'j@e.com');
    insert into profiles (id, display_name) values
      ('${REFERRER}', 'R'), ('${HOST}', 'H'),
      ('aaaaaaaa-0000-4000-8000-000000000001', 'Q'),
      ('aaaaaaaa-0000-4000-8000-000000000002', 'J');
    insert into referrals (referrer_id, referred_host_id, qualified_at) values
      ('${REFERRER}', 'aaaaaaaa-0000-4000-8000-000000000001', timestamptz '2026-01-01');
    insert into referrals (referrer_id, referred_host_id) values
      ('${REFERRER}', 'aaaaaaaa-0000-4000-8000-000000000002');
  `;

  it("rewards exactly the already-qualified referral, once, dated to qualification", async () => {
    const d = await withBackfill(seed);
    const got = (
      await d.query<{ referral_id: string; amount_cents: number; created_at: string }>(
        `select referral_id::text, amount_cents, created_at::text from referral_rewards`,
      )
    ).rows;
    expect(got).toHaveLength(1); // only the qualified one
    expect(got[0].amount_cents).toBe(2500);
    expect(got[0].created_at).toContain("2026-01-01"); // dated to qualified_at
    await d.close();
  });

  it("is idempotent — applying 0062 again rewards nothing new", async () => {
    const d = await withBackfill(seed);
    await d.exec(read("0062_referral_rewards.sql")); // run the whole migration again
    const [{ n }] = (
      await d.query<{ n: number }>(`select count(*)::int as n from referral_rewards`)
    ).rows;
    expect(n).toBe(1);
    await d.close();
  });

  it("skips a qualified referral whose referrer's account was deleted", async () => {
    const active = "e1000000-0000-4000-8000-000000000001";
    const deleted = "e1000000-0000-4000-8000-000000000002";
    const deletedSeed = `
      insert into auth.users (id, email) values
        ('${active}', 'a@e.com'), ('${deleted}', 'd@e.com');
      insert into profiles (id, display_name) values
        ('${active}', 'Active'), ('${deleted}', 'Deleted');
      insert into referrals (referrer_id, referred_host_id, qualified_at) values
        ('${active}', 'dddddddd-0000-4000-8000-000000000001', timestamptz '2026-01-01'),
        ('${deleted}', 'dddddddd-0000-4000-8000-000000000002', timestamptz '2026-01-02');
      -- The deleted referrer: auth user gone, scrubbed profile kept.
      set session_replication_role = replica;
      delete from auth.users where id = '${deleted}';
      set session_replication_role = default;
    `;
    const d = await withBackfill(deletedSeed);
    const got = (
      await d.query<{ referrer_id: string }>(`select referrer_id::text from referral_rewards`)
    ).rows;
    // Only the active referrer is rewarded; the deleted one is skipped even
    // though its scrubbed profile still exists.
    expect(got.map((r) => r.referrer_id)).toEqual([active]);
    await d.close();
  });
});
