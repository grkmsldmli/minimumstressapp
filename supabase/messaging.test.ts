import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Booking-scoped messaging, hardened — proved against a real Postgres.
 *
 * The masking, the read boundary, the thread scoping, and the send lifecycle are
 * all database behaviour, so they are executed (migrations 0015 + 0063) rather
 * than eyeballed: a client must never reach original_body, never rewrite a
 * message, never touch a thread it is not on, and never send on a booking that
 * is not a confirmed one.
 */
const STUBS = "0000_supabase_stubs.sql";
const migrationsDir = join(import.meta.dirname, "migrations");
const MIGRATIONS = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const HOST = "11111111-1111-1111-1111-111111111111";
const PRAC = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const SPACE = "44444444-4444-4444-4444-444444444444";
const CONFIRMED = "55555555-5555-5555-5555-555555555555";
const PENDING = "66666666-6666-6666-6666-666666666666";
const CANCELLED = "77777777-7777-7777-7777-777777777777";

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never[])).rows;
}

async function asUser<T = Record<string, unknown>>(
  userId: string,
  sql: string,
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${userId}', true);
    `);
    return (await tx.query<T>(sql)).rows;
  }) as Promise<T[]>;
}

function booking(id: string, opts: { captured: string; status: string; approval: string }): string {
  return `
    insert into bookings (
      id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
      host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
      credit_applied_cents, total_cents, platform_cents, status, captured_at, approval_state
    ) values (
      '${id}', '${SPACE}', '${PRAC}', now() + interval '1 day', now() + interval '25 hours',
      false, false, 4500, 900, 0, 0, 0, 5400, 900, '${opts.status}', ${opts.captured}, '${opts.approval}'
    );`;
}

/** Insert a message as the server would (service role / superuser). */
function message(id: string, bookingId: string, sender: string, body: string, original: string | null): string {
  return `
    insert into messages (id, booking_id, sender_id, body, original_body, redacted_kinds)
    values ('${id}', '${bookingId}', '${sender}', '${body}',
            ${original === null ? "null" : `'${original}'`},
            ${original === null ? "'{}'" : `'{phone}'`});`;
}

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
    truncate table auth.users cascade;
    insert into auth.users (id, email) values
      ('${HOST}', 'host@e.com'), ('${PRAC}', 'prac@e.com'), ('${STRANGER}', 'stranger@e.com');
    insert into profiles (id, display_name) values
      ('${HOST}', 'Willow'), ('${PRAC}', 'Elena'), ('${STRANGER}', 'Nosy');
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${SPACE}', '${HOST}', 'Willow', 'physical', 4500, 3, 'keypad',
      'Panel', '1 Way', 'active', 'space/x/lease.pdf', now(), 'verified', now()
    );
    ${booking(CONFIRMED, { captured: "now()", status: "upcoming", approval: "not_required" })}
    ${booking(PENDING, { captured: "null", status: "upcoming", approval: "pending" })}
    ${booking(CANCELLED, { captured: "now()", status: "cancelled_by_practitioner", approval: "not_required" })}
  `);
});

describe("original_body never reaches a client", () => {
  beforeEach(async () => {
    await rows(message("a0000000-0000-4000-8000-000000000001", CONFIRMED, HOST, "call me 555", "call me 555-1234"));
  });

  it("refuses a direct select of original_body", async () => {
    await expect(
      asUser(PRAC, `select original_body from messages where booking_id = '${CONFIRMED}'`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses select * on the base table (it would include original_body)", async () => {
    await expect(
      asUser(PRAC, `select * from messages where booking_id = '${CONFIRMED}'`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("gives the masked body through messages_visible, with no original_body column", async () => {
    const seen = await asUser(PRAC, `select * from messages_visible where booking_id = '${CONFIRMED}'`);
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0])).not.toContain("original_body");
    expect(seen[0].body).toBe("call me 555"); // the masked text, not the original
  });
});

describe("a client cannot rewrite a message", () => {
  beforeEach(async () => {
    await rows(message("a1000000-0000-4000-8000-000000000001", CONFIRMED, HOST, "hi", null));
  });

  it("refuses updates to body, original_body, sender_id, and booking_id", async () => {
    for (const set of [
      "body = 'hacked'",
      "original_body = 'x'",
      `sender_id = '${PRAC}'`,
      `booking_id = '${PENDING}'`,
    ]) {
      await expect(
        asUser(PRAC, `update messages set ${set} where booking_id = '${CONFIRMED}'`),
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("marking read is the only write, and is scoped", () => {
  beforeEach(async () => {
    // HOST wrote to PRAC; PRAC wrote back.
    await rows(message("a2000000-0000-4000-8000-000000000001", CONFIRMED, HOST, "from host", null));
    await rows(message("a2000000-0000-4000-8000-000000000002", CONFIRMED, PRAC, "from prac", null));
  });

  it("lets the recipient mark only incoming messages read, and is idempotent", async () => {
    const [{ mark_messages_read: first }] = await asUser<{ mark_messages_read: number }>(
      PRAC,
      `select mark_messages_read('${CONFIRMED}')`,
    );
    expect(first).toBe(1); // only HOST's message, addressed to PRAC

    const [{ mark_messages_read: again }] = await asUser<{ mark_messages_read: number }>(
      PRAC,
      `select mark_messages_read('${CONFIRMED}')`,
    );
    expect(again).toBe(0); // idempotent

    // PRAC's own message was never marked read by PRAC.
    const [own] = await rows<{ read_at: string | null }>(
      `select read_at from messages where id = 'a2000000-0000-4000-8000-000000000002'`,
    );
    expect(own.read_at).toBeNull();
  });

  it("does not let a sender mark their own outgoing message read", async () => {
    await asUser(HOST, `select mark_messages_read('${CONFIRMED}')`);
    const [hostMsg] = await rows<{ read_at: string | null }>(
      `select read_at from messages where id = 'a2000000-0000-4000-8000-000000000001'`,
    );
    expect(hostMsg.read_at).toBeNull(); // HOST's own message stays unread
  });

  it("does nothing for a stranger", async () => {
    const [{ mark_messages_read: n }] = await asUser<{ mark_messages_read: number }>(
      STRANGER,
      `select mark_messages_read('${CONFIRMED}')`,
    );
    expect(n).toBe(0);
  });
});

describe("threads are scoped to their two participants", () => {
  beforeEach(async () => {
    await rows(message("a3000000-0000-4000-8000-000000000001", CONFIRMED, HOST, "hi", null));
  });

  it("a stranger reads nothing from the thread", async () => {
    const seen = await asUser(STRANGER, `select * from messages_visible where booking_id = '${CONFIRMED}'`);
    expect(seen).toHaveLength(0);
  });

  it("both participants read the thread", async () => {
    expect(await asUser(PRAC, `select id from messages_visible where booking_id = '${CONFIRMED}'`)).toHaveLength(1);
    expect(await asUser(HOST, `select id from messages_visible where booking_id = '${CONFIRMED}'`)).toHaveLength(1);
  });
});

describe("new messages only on a confirmed booking", () => {
  it("allows a message on a confirmed, captured booking", async () => {
    await expect(
      rows(message("b0000000-0000-4000-8000-000000000001", CONFIRMED, HOST, "hi", null)),
    ).resolves.toBeDefined();
  });

  it("refuses a message on a pending request", async () => {
    await expect(
      rows(message("b0000000-0000-4000-8000-000000000002", PENDING, HOST, "hi", null)),
    ).rejects.toThrow(/confirmed booking/i);
  });

  it("refuses a message on a cancelled booking", async () => {
    await expect(
      rows(message("b0000000-0000-4000-8000-000000000003", CANCELLED, HOST, "hi", null)),
    ).rejects.toThrow(/confirmed booking/i);
  });

  it("keeps historical messages readable after the booking is cancelled", async () => {
    // Sent while confirmed...
    await rows(message("b1000000-0000-4000-8000-000000000001", CONFIRMED, HOST, "before", null));
    // ...then the booking is cancelled.
    await rows(`update bookings set status = 'cancelled_by_host' where id = '${CONFIRMED}'`);

    // The old message is still readable...
    expect(await asUser(PRAC, `select id from messages_visible where booking_id = '${CONFIRMED}'`)).toHaveLength(1);
    // ...but no new message can be sent.
    await expect(
      rows(message("b1000000-0000-4000-8000-000000000002", CONFIRMED, HOST, "after", null)),
    ).rejects.toThrow(/confirmed booking/i);
  });
});

describe("unread counts come from server truth", () => {
  it("counts incoming unread, never the caller's own outgoing", async () => {
    await rows(message("c0000000-0000-4000-8000-000000000001", CONFIRMED, HOST, "one", null));
    await rows(message("c0000000-0000-4000-8000-000000000002", CONFIRMED, HOST, "two", null));
    await rows(message("c0000000-0000-4000-8000-000000000003", CONFIRMED, PRAC, "mine", null));

    const [prac] = await asUser<{ booking_id: string; unread: number }>(
      PRAC,
      `select booking_id::text, unread from unread_message_counts()`,
    );
    expect(prac.unread).toBe(2); // the two from HOST, not PRAC's own

    // After opening the thread, nothing is unread.
    await asUser(PRAC, `select mark_messages_read('${CONFIRMED}')`);
    expect(await asUser(PRAC, `select * from unread_message_counts()`)).toHaveLength(0);
  });
});
