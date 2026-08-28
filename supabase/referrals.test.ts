import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The host referral foundation, against a real Postgres (PGlite).
 *
 * Attribution, eligibility and qualification are database behaviour, so they are
 * proved by executing migration 0061 rather than reading it. There is no reward
 * here; these tests guard attribution, the anti-abuse, and — after review — the
 * server-only referrer ledger, durable eligibility, and the space-approval
 * insert boundary the eligibility rule leans on.
 */
const STUBS = "0000_supabase_stubs.sql";
const migrationsDir = join(import.meta.dirname, "migrations");
const MIGRATIONS = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const REFERRER = "11111111-1111-1111-1111-111111111111";
const HOST = "22222222-2222-2222-2222-222222222222"; // the brought (referred) host
const PRAC = "33333333-3333-3333-3333-333333333333"; // books the brought host's room
const CODE = "REF00001";
const SPACE = "44444444-4444-4444-4444-444444444444";

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never[])).rows;
}

/** Run as an end user, RLS applied, returning rows. */
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

/** Attribute as the brought host would: signed in, calling with the code. */
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

/** Staff approval: pending -> active + verified, which fires the go-live trigger. */
const approve = (id: string) =>
  rows(`update spaces set status = 'active', sublease_doc_state = 'verified',
          sublease_doc_reviewed_at = now()
        where id = '${id}' and status = 'pending'`);

const codeOf = async (hostId: string): Promise<string | null> => {
  const [row] = await rows<{ code: string | null }>(
    `select code from referrer_codes where host_id = '${hostId}'`,
  );
  return row?.code ?? null;
};

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

const referralRow = () =>
  rows<{
    referrer_id: string;
    listing_live_at: string | null;
    qualified_at: string | null;
    first_qualifying_booking_id: string | null;
  }>(
    `select referrer_id::text, listing_live_at::text, qualified_at::text,
            first_qualifying_booking_id::text
     from referrals where referred_host_id = '${HOST}'`,
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
  // TRUNCATE (not DELETE): 0060's guard forbids deleting a completed booking.
  // referrer_codes and referrals carry no FK to auth.users, so name them too.
  await db.exec(`
    truncate table auth.users, referrals, referrer_codes cascade;

    insert into auth.users (id, email) values
      ('${REFERRER}', 'referrer@example.com'),
      ('${HOST}', 'host@example.com'),
      ('${PRAC}', 'prac@example.com');
    insert into profiles (id, display_name) values
      ('${REFERRER}', 'Referrer'),
      ('${HOST}', 'Brought Host'),
      ('${PRAC}', 'Practitioner');

    -- REFERRER is an established, eligible referrer with a known code. The brought
    -- host has no space yet, so they are eligible to be referred.
    insert into referrer_codes (host_id, code) values ('${REFERRER}', '${CODE}');
  `);
});

describe("the referral code lives in a server-only ledger", () => {
  it("is granted to a host on approval — stable, opaque, and unique", async () => {
    const h1 = "e0000000-0000-4000-8000-000000000001";
    const h2 = "e0000000-0000-4000-8000-000000000002";
    for (const id of [h1, h2]) {
      await rows(`insert into auth.users (id, email) values ('${id}', '${id}@e.com')`);
      await rows(`insert into profiles (id, display_name) values ('${id}', 'H')`);
    }
    await rows(pendingSpace("e1000000-0000-4000-8000-000000000001", h1));
    await rows(pendingSpace("e1000000-0000-4000-8000-000000000002", h2));
    await approve("e1000000-0000-4000-8000-000000000001");
    await approve("e1000000-0000-4000-8000-000000000002");

    const [{ my_referral_code: first }] = await asRole<{ my_referral_code: string }>(
      "authenticated",
      h1,
      `select my_referral_code()`,
    );
    const [{ my_referral_code: again }] = await asRole<{ my_referral_code: string }>(
      "authenticated",
      h1,
      `select my_referral_code()`,
    );
    const [{ my_referral_code: other }] = await asRole<{ my_referral_code: string }>(
      "authenticated",
      h2,
      `select my_referral_code()`,
    );
    expect(first).toHaveLength(8);
    expect(again).toBe(first); // stable
    expect(other).not.toBe(first); // unique per host
  });

  it("is never held by an account that has not been approved", async () => {
    const [row] = await asRole<{ my_referral_code: string | null }>(
      "authenticated",
      PRAC,
      `select my_referral_code()`,
    );
    expect(row.my_referral_code).toBeNull();
  });

  it("cannot be read, planted, replaced, or cleared by a client", async () => {
    // No client may see the ledger, insert a code, change one, or null it.
    await expect(asRole("authenticated", REFERRER, `select * from referrer_codes`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asRole("authenticated", HOST, `insert into referrer_codes (host_id, code) values ('${HOST}', 'PLANT001')`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("authenticated", REFERRER, `update referrer_codes set code = 'HACKED42' where host_id = '${REFERRER}'`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("authenticated", REFERRER, `update referrer_codes set code = null where host_id = '${REFERRER}'`),
    ).rejects.toThrow(/permission denied/i);
    // And no referral_code column survives on the client-writable profiles table.
    const cols = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'profiles' and column_name = 'referral_code'`,
    );
    expect(cols).toHaveLength(0);
  });
});

describe("attribution locks a brought host to one referrer", () => {
  it("attributes a new host exactly once", async () => {
    await attributeAs(HOST, CODE);
    await attributeAs(HOST, CODE); // again — no second row, no change

    const r = await referralRow();
    expect(r).toHaveLength(1);
    expect(r[0].referrer_id).toBe(REFERRER);
    expect(r[0].qualified_at).toBeNull();
  });

  it("refuses a self-referral", async () => {
    await attributeAs(REFERRER, CODE);
    expect(
      await rows(`select 1 from referrals where referred_host_id = '${REFERRER}'`),
    ).toHaveLength(0);
  });

  it("does not let a second referrer steal an attributed host", async () => {
    await attributeAs(HOST, CODE); // locked to REFERRER

    const rival = "99999999-9999-4999-8999-999999999999";
    await rows(`insert into auth.users (id, email) values ('${rival}', 'rival@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${rival}', 'Rival')`);
    await rows(`insert into referrer_codes (host_id, code) values ('${rival}', 'RIVAL001')`);

    await attributeAs(HOST, "RIVAL001"); // attempt to re-point
    expect((await referralRow())[0].referrer_id).toBe(REFERRER); // unchanged
  });

  it("ignores an unknown code", async () => {
    await attributeAs(HOST, "NOTACODE");
    expect(await referralRow()).toHaveLength(0);
  });

  it("does not let a reciprocal loop form", async () => {
    await attributeAs(HOST, CODE); // REFERRER -> HOST
    // HOST becomes an eligible referrer with a code of their own.
    await rows(`insert into referrer_codes (host_id, code) values ('${HOST}', 'HOSTCODE')`);
    // HOST -> REFERRER is refused outright by the reciprocal guard.
    await attributeAs(REFERRER, "HOSTCODE");
    expect(
      await rows(`select 1 from referrals where referred_host_id = '${REFERRER}'`),
    ).toHaveLength(0);
  });

  it("only attributes a genuinely new host — not one who already hosts", async () => {
    await rows(pendingSpace(SPACE, HOST));
    await attributeAs(HOST, CODE);
    expect(await referralRow()).toHaveLength(0);
  });

  it("a brought host with several spaces is still one referral", async () => {
    await attributeAs(HOST, CODE);
    await rows(pendingSpace(SPACE, HOST));
    await rows(pendingSpace("44444444-4444-4444-4444-444444444445", HOST));
    await approve(SPACE);
    await approve("44444444-4444-4444-4444-444444444445");
    expect(await referralRow()).toHaveLength(1);
  });
});

describe("referrer eligibility is earned by approval and is durable", () => {
  // A host who has never been approved.
  const CAND = "77777777-7777-4777-8777-777777777777";
  const CAND_SPACE = "77777777-7777-4777-8777-7777777777a1";
  const NEWCOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeEach(async () => {
    for (const [id, email] of [
      [CAND, "cand@e.com"],
      [NEWCOMER, "newcomer@e.com"],
    ] as const) {
      await rows(`insert into auth.users (id, email) values ('${id}', '${email}')`);
      await rows(`insert into profiles (id, display_name) values ('${id}', 'X')`);
    }
  });

  const canRefer = async (referrerId: string): Promise<boolean> => {
    const code = await codeOf(referrerId);
    if (!code) return false;
    await attributeAs(NEWCOMER, code);
    const hit = await rows(
      `select 1 from referrals where referred_host_id = '${NEWCOMER}' and referrer_id = '${referrerId}'`,
    );
    return hit.length === 1;
  };

  it("a never-approved practitioner has no code and cannot refer", async () => {
    expect(await codeOf(CAND)).toBeNull();
    expect(await canRefer(CAND)).toBe(false);
  });

  it("a host with only a pending or rejected listing cannot refer", async () => {
    await rows(pendingSpace(CAND_SPACE, CAND));
    expect(await codeOf(CAND)).toBeNull();
    await rows(`update spaces set status = 'delisted', sublease_doc_state = 'rejected',
                  sublease_doc_reviewed_at = now() where id = '${CAND_SPACE}'`);
    expect(await codeOf(CAND)).toBeNull();
  });

  it("a host with an approved listing can refer", async () => {
    await rows(pendingSpace(CAND_SPACE, CAND));
    await approve(CAND_SPACE);
    expect(await codeOf(CAND)).not.toBeNull();
    expect(await canRefer(CAND)).toBe(true);
  });

  it("stays eligible after the listing is later delisted", async () => {
    await rows(pendingSpace(CAND_SPACE, CAND));
    await approve(CAND_SPACE);
    const code = await codeOf(CAND);
    await rows(`update spaces set status = 'delisted' where id = '${CAND_SPACE}'`);
    expect(await codeOf(CAND)).toBe(code); // code persists
    expect(await canRefer(CAND)).toBe(true);
  });

  it("stays eligible after an edit sends the listing back to pending", async () => {
    await rows(pendingSpace(CAND_SPACE, CAND));
    await approve(CAND_SPACE);
    const code = await codeOf(CAND);
    // What the edit rules do to a listing whose address/document changed.
    await rows(`update spaces set status = 'pending', sublease_doc_state = 'pending',
                  sublease_doc_reviewed_at = null where id = '${CAND_SPACE}'`);
    expect(await codeOf(CAND)).toBe(code); // eligibility is not lost
    expect(await canRefer(CAND)).toBe(true);
  });

  it("stays eligible after a later rejection", async () => {
    await rows(pendingSpace(CAND_SPACE, CAND));
    await approve(CAND_SPACE);
    await rows(`update spaces set status = 'delisted', sublease_doc_state = 'rejected',
                  sublease_doc_reviewed_at = now() where id = '${CAND_SPACE}'`);
    expect(await canRefer(CAND)).toBe(true);
  });

  it("a practitioner with no spaces may be referred, then go on to host", async () => {
    await attributeAs(PRAC, CODE);
    const before = await rows<{ listing_live_at: string | null }>(
      `select listing_live_at::text from referrals where referred_host_id = '${PRAC}'`,
    );
    expect(before).toHaveLength(1);
    expect(before[0].listing_live_at).toBeNull();

    const pracSpace = "66666666-6666-4666-8666-666666666666";
    await rows(pendingSpace(pracSpace, PRAC));
    await approve(pracSpace);
    const after = await rows<{ listing_live_at: string | null }>(
      `select listing_live_at::text from referrals where referred_host_id = '${PRAC}'`,
    );
    expect(after[0].listing_live_at).not.toBeNull();
  });

  it("does not attribute an account that already has any space", async () => {
    await rows(pendingSpace(CAND_SPACE, NEWCOMER));
    await attributeAs(NEWCOMER, CODE);
    expect(
      await rows(`select 1 from referrals where referred_host_id = '${NEWCOMER}'`),
    ).toHaveLength(0);
  });
});

describe("progress and qualification follow real activity", () => {
  beforeEach(async () => {
    await attributeAs(HOST, CODE);
  });

  it("stays 'joined' for a draft/pending/rejected listing", async () => {
    await rows(pendingSpace(SPACE, HOST));
    expect((await referralRow())[0].listing_live_at).toBeNull();
    await rows(`update spaces set status = 'delisted', sublease_doc_state = 'rejected',
                  sublease_doc_reviewed_at = now() where id = '${SPACE}'`);
    expect((await referralRow())[0].listing_live_at).toBeNull();
  });

  it("moves to 'space live' when the first listing is genuinely approved", async () => {
    await rows(pendingSpace(SPACE, HOST));
    await approve(SPACE);
    const r = await referralRow();
    expect(r[0].listing_live_at).not.toBeNull();
    expect(r[0].qualified_at).toBeNull();
  });

  it("does not qualify on unpaid, cancelled, no-show, or uncaptured bookings", async () => {
    await rows(pendingSpace(SPACE, HOST));
    await approve(SPACE);

    for (const [id, end] of [
      ["b0000000-0000-4000-8000-000000000001", "cancelled_by_host"],
      ["b0000000-0000-4000-8000-000000000002", "no_show"],
    ] as const) {
      await rows(insertBooking(id, "upcoming", "now()"));
      await rows(`update bookings set status = '${end}' where id = '${id}'`);
    }
    await rows(insertBooking("b0000000-0000-4000-8000-000000000003", "upcoming", "null"));
    await rows(
      `update bookings set status = 'completed' where id = 'b0000000-0000-4000-8000-000000000003'`,
    );

    expect((await referralRow())[0].qualified_at).toBeNull();
  });

  it("qualifies on the first completed, captured booking — exactly once", async () => {
    await rows(pendingSpace(SPACE, HOST));
    await approve(SPACE);

    const first = "b1000000-0000-4000-8000-000000000001";
    await rows(insertBooking(first, "upcoming", "now()"));
    await rows(`update bookings set status = 'completed' where id = '${first}'`);

    let r = await referralRow();
    expect(r[0].qualified_at).not.toBeNull();
    expect(r[0].first_qualifying_booking_id).toBe(first);
    const qualifiedAt = r[0].qualified_at;

    const second = "b1000000-0000-4000-8000-000000000002";
    await rows(insertBooking(second, "upcoming", "now()"));
    await rows(`update bookings set status = 'completed' where id = '${second}'`);

    r = await referralRow();
    expect(r[0].qualified_at).toBe(qualifiedAt);
    expect(r[0].first_qualifying_booking_id).toBe(first);
  });
});

describe("the referrer authority is the server's alone", () => {
  it("refuses any client read or write of the referrals table", async () => {
    await attributeAs(HOST, CODE);
    await expect(asRole("authenticated", REFERRER, `select * from referrals`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asRole(
        "authenticated",
        HOST,
        `insert into referrals (referrer_id, referred_host_id) values ('${HOST}', '${PRAC}')`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("authenticated", HOST, `update referrals set qualified_at = now()`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("shows a referrer only safe fields about their referrals — no raw ids or PII", async () => {
    await attributeAs(HOST, CODE);
    const seen = await asRole<{ id: string; status: string; joined_at: string }>(
      "authenticated",
      REFERRER,
      `select * from my_referrals()`,
    );
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]).sort()).toEqual(["id", "joined_at", "status"]);
    expect(seen[0].status).toBe("joined");
    expect(JSON.stringify(seen[0])).not.toContain(HOST);
  });

  it("shows the qualified status through the safe projection once earned", async () => {
    await attributeAs(HOST, CODE);
    await rows(pendingSpace(SPACE, HOST));
    await approve(SPACE);
    const b = "b2000000-0000-4000-8000-000000000001";
    await rows(insertBooking(b, "upcoming", "now()"));
    await rows(`update bookings set status = 'completed' where id = '${b}'`);

    const [row] = await asRole<{ status: string }>(
      "authenticated",
      REFERRER,
      `select status from my_referrals()`,
    );
    expect(row.status).toBe("qualified");
  });
});

describe("a later reward can attach without rewriting history", () => {
  it("keeps referrals.id stable and lets a reward reference it", async () => {
    await attributeAs(HOST, CODE);
    await rows(pendingSpace(SPACE, HOST));
    await approve(SPACE);
    const b = "b3000000-0000-4000-8000-000000000001";
    await rows(insertBooking(b, "upcoming", "now()"));
    await rows(`update bookings set status = 'completed' where id = '${b}'`);

    const [{ id, qualified_at }] = await rows<{ id: string; qualified_at: string }>(
      `select id::text, qualified_at::text from referrals where referred_host_id = '${HOST}'`,
    );

    await rows(`
      create table tmp_referral_rewards (
        id uuid primary key default gen_random_uuid(),
        referral_id uuid not null references referrals(id),
        created_at timestamptz not null default now()
      );
    `);
    await expect(
      rows(`insert into tmp_referral_rewards (referral_id) values ('${id}')`),
    ).resolves.toBeDefined();

    const [after] = await rows<{ id: string; qualified_at: string }>(
      `select id::text, qualified_at::text from referrals where referred_host_id = '${HOST}'`,
    );
    expect(after.id).toBe(id);
    expect(after.qualified_at).toBe(qualified_at);
    await rows(`drop table tmp_referral_rewards`);
  });
});

describe("a client cannot self-approve a listing on insert", () => {
  const CRAFTER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  beforeEach(async () => {
    await rows(`insert into auth.users (id, email) values ('${CRAFTER}', 'craft@e.com')`);
    // A real host account that has accepted the current host terms — otherwise
    // the 0052 insert policy refuses the listing before the guard is even tested.
    await rows(`insert into profiles (id, display_name, account_type, host_terms_version)
                values ('${CRAFTER}', 'Crafter', 'host', (select required_host_terms_version()))`);
  });

  // A normal Add Space insert — no status or verdict fields, exactly as the app.
  const normalInsert = (id: string) =>
    asRole(
      "authenticated",
      CRAFTER,
      `insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, sublease_doc_path, legal_ack_at
      ) values (
        '${id}', '${CRAFTER}', 'Crafted', 'physical', 4500, 3, 'keypad',
        'Panel', '1 Way', 'space/x/lease.pdf', now()
      )`,
    );

  it("normalises a crafted active + verified insert back to pending, unreviewed", async () => {
    const id = "c1000000-0000-4000-8000-000000000001";
    await asRole(
      "authenticated",
      CRAFTER,
      `insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at, doc_review_note
      ) values (
        '${id}', '${CRAFTER}', 'Crafted', 'physical', 4500, 3, 'keypad',
        'Panel', '1 Way', 'active', 'space/x/lease.pdf', now(),
        'verified', now(), 'looks great'
      )`,
    );
    const [s] = await rows<{
      status: string;
      sublease_doc_state: string;
      sublease_doc_reviewed_at: string | null;
      doc_review_note: string | null;
    }>(
      `select status::text, sublease_doc_state::text, sublease_doc_reviewed_at::text, doc_review_note
       from spaces where id = '${id}'`,
    );
    expect(s.status).toBe("pending");
    expect(s.sublease_doc_state).toBe("pending");
    expect(s.sublease_doc_reviewed_at).toBeNull();
    expect(s.doc_review_note).toBeNull();
    // Never became a real, live listing, so it confers no referrer eligibility.
    expect(await codeOf(CRAFTER)).toBeNull();
  });

  it("lets a normal pending listing be created", async () => {
    const id = "c2000000-0000-4000-8000-000000000001";
    await normalInsert(id);
    const [s] = await rows<{ status: string; sublease_doc_state: string }>(
      `select status::text, sublease_doc_state::text from spaces where id = '${id}'`,
    );
    expect(s.status).toBe("pending");
    expect(s.sublease_doc_state).toBe("pending");
  });

  it("still lets staff (service role) approve a listing", async () => {
    const id = "c3000000-0000-4000-8000-000000000001";
    await normalInsert(id);
    await approve(id); // service-role update, as staff review does
    const [s] = await rows<{ status: string }>(
      `select status::text from spaces where id = '${id}'`,
    );
    expect(s.status).toBe("active");
    // Approval grants the host referrer eligibility, as designed.
    expect(await codeOf(CRAFTER)).not.toBeNull();
  });
});

describe("deleting the account disables the code but keeps referral history", () => {
  it("removes the referrer code on account deletion, and old code stops attributing", async () => {
    // REFERRER is eligible and has brought HOST in.
    await attributeAs(HOST, CODE);
    expect((await referralRow())[0].referrer_id).toBe(REFERRER);
    expect(await codeOf(REFERRER)).toBe(CODE);

    // The account is deleted: auth.users -> profiles -> referrer_codes all cascade.
    await rows(`delete from auth.users where id = '${REFERRER}'`);

    // The code is gone with the account.
    expect(await codeOf(REFERRER)).toBeNull();

    // And it can no longer attribute a brand-new host.
    const newcomer = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await rows(`insert into auth.users (id, email) values ('${newcomer}', 'nc@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${newcomer}', 'Newcomer')`);
    await attributeAs(newcomer, CODE);
    expect(
      await rows(`select 1 from referrals where referred_host_id = '${newcomer}'`),
    ).toHaveLength(0);

    // Existing referral history survives — it has no FK to delete it.
    const hist = await rows<{ referrer_id: string }>(
      `select referrer_id::text from referrals where referred_host_id = '${HOST}'`,
    );
    expect(hist).toHaveLength(1);
    expect(hist[0].referrer_id).toBe(REFERRER);
  });

  it("does not remove eligibility when a listing is only delisted", async () => {
    // A distinct established host, then delisting must NOT cascade the code away.
    const h = "e5000000-0000-4000-8000-000000000001";
    const s = "e5000000-0000-4000-8000-0000000000a1";
    await rows(`insert into auth.users (id, email) values ('${h}', 'e5@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${h}', 'H')`);
    await rows(pendingSpace(s, h));
    await approve(s);
    const code = await codeOf(h);
    expect(code).not.toBeNull();

    await rows(`update spaces set status = 'delisted' where id = '${s}'`);
    expect(await codeOf(h)).toBe(code); // still eligible — no account was deleted
  });
});

describe("ensure_referrer is an internal helper, not client-callable", () => {
  it("refuses an authenticated caller for themselves", async () => {
    await expect(
      asRole("authenticated", HOST, `select ensure_referrer('${HOST}')`),
    ).rejects.toThrow(/permission denied/i);
    expect(await codeOf(HOST)).toBeNull(); // no eligibility minted
  });

  it("refuses an authenticated caller for another user", async () => {
    await expect(
      asRole("authenticated", HOST, `select ensure_referrer('${PRAC}')`),
    ).rejects.toThrow(/permission denied/i);
    expect(await codeOf(PRAC)).toBeNull();
  });

  it("refuses an anon caller", async () => {
    await expect(asRole("anon", "", `select ensure_referrer('${HOST}')`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("still grants eligibility on a genuine staff approval", async () => {
    const h = "d5000000-0000-4000-8000-000000000001";
    const s = "d5000000-0000-4000-8000-0000000000a1";
    await rows(`insert into auth.users (id, email) values ('${h}', 'd5@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${h}', 'H')`);
    await rows(pendingSpace(s, h));
    expect(await codeOf(h)).toBeNull(); // not eligible until approved
    await approve(s); // the trigger calls ensure_referrer as the owner
    expect(await codeOf(h)).not.toBeNull();
  });
});

describe("the migration backfill still grants eligibility after the revoke", () => {
  // A database brought to just before 0061, seeded, then through 0061 — so its
  // backfill (which calls ensure_referrer) runs against the seeded world.
  async function withBackfill(seedSql: string): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(read(STUBS));
    for (const m of MIGRATIONS) {
      if (m === "0061_host_referrals.sql") await d.exec(seedSql);
      await d.exec(read(m));
    }
    return d;
  }

  it("creates codes for a verified host and a founding host when 0061 runs", async () => {
    const A = "b0000000-0000-4000-8000-00000000000a"; // has a verified listing
    const B = "b0000000-0000-4000-8000-00000000000b"; // founding host, no verified listing now
    const seed = `
      insert into auth.users (id, email) values ('${A}', 'a@e.com'), ('${B}', 'b@e.com');
      insert into profiles (id, display_name) values ('${A}', 'A'), ('${B}', 'B');
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        'b1000000-0000-4000-8000-00000000000a', '${A}', 'Room', 'physical', 4500, 3, 'keypad',
        'Panel', '1 Way', 'active', 'space/x/lease.pdf', now(), 'verified', now()
      );
      insert into founding_hosts (founding_number, host_id, earned_at) values (1, '${B}', now());
    `;
    const d = await withBackfill(seed);
    const got = (
      await d.query<{ host_id: string; code: string }>(
        `select host_id::text, code from referrer_codes order by host_id`,
      )
    ).rows;
    const hosts = got.map((r) => r.host_id);
    expect(hosts).toContain(A);
    expect(hosts).toContain(B);
    expect(got.every((r) => typeof r.code === "string" && r.code.length === 8)).toBe(true);
    await d.close();
  });
});
