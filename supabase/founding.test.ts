import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FOUNDING_HOST_LIMIT } from "../src/lib/founding";
import { SESSION_MILESTONE_THRESHOLDS } from "../src/lib/host-achievements";

/**
 * The Founding 50 award, run against a real Postgres (PGlite).
 *
 * The guarantees that matter here — a fifty-first can never be granted, a host
 * counts once however many rooms they list, the status is permanent, and no
 * signed-in account can grant it to itself — are database behaviour, not app
 * behaviour, so they are proved by executing migration 0060 rather than reading
 * it. The app only ever calls `award_founding_host` at the one moment a listing
 * goes live; that wiring is in the admin route, and what it relies on is here.
 */
const STUBS = "0000_supabase_stubs.sql";
const migrationsDir = join(import.meta.dirname, "migrations");
const MIGRATIONS = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const HOST = "11111111-1111-1111-1111-111111111111";
const PRAC = "22222222-2222-2222-2222-222222222222";
const SPACE = "44444444-4444-4444-4444-444444444444";

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

/** Read as a given role, with RLS applied, returning the rows. */
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

/** A live listing, with the verified lease 0018 requires on an active row. */
function activeSpace(id: string, host: string, name: string): string {
  return `
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${id}', '${host}', '${name}', 'physical', 4500, 3, 'keypad',
      'Panel by the door', '1 Alder Lane', 'active',
      'space/x/lease.pdf', now(), 'verified', now()
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
  // A clean slate each test: no founding rows carried over, one host with one
  // live listing and a practitioner to book it.
  // TRUNCATE, not DELETE: the achievement guard forbids deleting a completed,
  // captured booking, and cascading truncate from auth.users clears every table
  // that references it. founding_hosts has no such reference, so it is named too.
  await db.exec(`
    truncate table auth.users, founding_hosts cascade;

    insert into auth.users (id, email) values
      ('${HOST}', 'host@example.com'),
      ('${PRAC}', 'prac@example.com');
    insert into profiles (id, display_name) values
      ('${HOST}', 'Willow Studio'),
      ('${PRAC}', 'Elena R.');
    ${activeSpace(SPACE, HOST, "Willow")}
  `);
});

describe("earning the status", () => {
  it("awards number 1 and a durable timestamp on the first listing to go live", async () => {
    await rows(`select award_founding_host('${HOST}')`);
    const [p] = await rows<{ founding_number: number; founding_host_at: string | null }>(
      `select founding_number, founding_host_at from profiles where id = '${HOST}'`,
    );
    expect(p.founding_number).toBe(1);
    expect(p.founding_host_at).not.toBeNull();
  });

  it("counts a host once, however many of their listings go live", async () => {
    // Two rooms, two approvals — the award fires on each, and the host still
    // holds exactly one spot with its original number.
    await rows(activeSpace("44444444-4444-4444-4444-444444444445", HOST, "Second room"));
    await rows(`select award_founding_host('${HOST}')`);
    await rows(`select award_founding_host('${HOST}')`);

    const [p] = await rows<{ founding_number: number; c: number }>(
      `select founding_number, (select count(*) from profiles where founding_number is not null)::int as c
       from profiles where id = '${HOST}'`,
    );
    expect(p.founding_number).toBe(1);
    expect(p.c).toBe(1);
  });

  it("is permanent — deactivating every listing does not take it away", async () => {
    await rows(`select award_founding_host('${HOST}')`);
    await rows(`update spaces set status = 'delisted' where host_id = '${HOST}'`);

    const [p] = await rows<{ founding_number: number | null }>(
      `select founding_number from profiles where id = '${HOST}'`,
    );
    expect(p.founding_number).toBe(1);
  });

  it("hands out 1, 2, 3 in the order hosts go live", async () => {
    const ids = [
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-0000-4000-8000-000000000002",
    ];
    for (const id of ids) {
      await rows(`insert into auth.users (id, email) values ('${id}', '${id}@e.com')`);
      await rows(`insert into profiles (id, display_name) values ('${id}', 'H')`);
    }
    await rows(`select award_founding_host('${HOST}')`);
    await rows(`select award_founding_host('${ids[0]}')`);
    await rows(`select award_founding_host('${ids[1]}')`);

    const got = await rows<{ founding_number: number }>(
      `select founding_number from profiles where founding_number is not null order by founding_number`,
    );
    expect(got.map((r) => r.founding_number)).toEqual([1, 2, 3]);
  });
});

describe("the cap can never be exceeded", () => {
  it("grants exactly fifty and refuses the fifty-first", async () => {
    // Fifty-one hosts, each brought live in turn. The fifty-first must come
    // away with nothing, the count must stop at fifty, and no spot must remain.
    await db.exec(`
      insert into auth.users (id, email)
        select ('cccccccc-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'h' || n || '@e.com'
        from generate_series(1, 51) n;
      insert into profiles (id, display_name)
        select ('cccccccc-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Host ' || n
        from generate_series(1, 51) n;
      do $$
      declare i int;
      begin
        for i in 1..51 loop
          perform award_founding_host(('cccccccc-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid);
        end loop;
      end $$;
    `);

    const [{ c, top }] = await rows<{ c: number; top: number }>(
      `select count(*)::int as c, coalesce(max(founding_number), 0)::int as top
       from profiles where founding_number is not null`,
    );
    expect(c).toBe(50);
    expect(top).toBe(50);

    const [{ n }] = await rows<{ n: number }>(`select founding_hosts_remaining() as n`);
    expect(n).toBe(0);

    // The fifty-first host — number 51 in the loop — holds no founding status.
    const fiftyFirst = "cccccccc-0000-4000-8000-000000000051";
    const [p] = await rows<{ founding_number: number | null }>(
      `select founding_number from profiles where id = '${fiftyFirst}'`,
    );
    expect(p.founding_number).toBeNull();
  });

  it("keeps the schema itself a backstop: no number above fifty, no duplicate", async () => {
    // Even a caller that bypassed the function entirely (this runs as superuser,
    // past the client trigger) is stopped by the row constraints from 0060.
    await expect(
      rows(`update profiles set founding_host_at = now(), founding_number = 51 where id = '${HOST}'`),
    ).rejects.toThrow();

    await rows(`select award_founding_host('${HOST}')`); // host takes number 1
    const id = "dddddddd-0000-4000-8000-000000000001";
    await rows(`insert into auth.users (id, email) values ('${id}', 'd@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${id}', 'D')`);
    await expect(
      rows(`update profiles set founding_host_at = now(), founding_number = 1 where id = '${id}'`),
    ).rejects.toThrow(); // 1 is already taken — unique index refuses it
  });
});

describe("only the server may grant it", () => {
  it("refuses a signed-in account setting founding fields on its own row", async () => {
    await expect(
      asUser(HOST, `update profiles set founding_host_at = now(), founding_number = 1 where id = '${HOST}'`),
    ).rejects.toThrow(/server/i);
  });

  it("refuses a crafted first insert that arrives already founding", async () => {
    const id = "eeeeeeee-0000-4000-8000-000000000001";
    await rows(`insert into auth.users (id, email) values ('${id}', 'e@e.com')`);
    await expect(
      asUser(
        id,
        `insert into profiles (id, display_name, founding_host_at, founding_number)
         values ('${id}', 'Sneaky', now(), 1)`,
      ),
    ).rejects.toThrow(/server/i);
  });
});

describe("spots remaining is derived from real rows", () => {
  it("counts down from fifty as hosts are awarded, never a stored number", async () => {
    const [{ n0 }] = await rows<{ n0: number }>(`select founding_hosts_remaining() as n0`);
    expect(n0).toBe(50);

    await rows(`select award_founding_host('${HOST}')`);
    const [{ n1 }] = await rows<{ n1: number }>(`select founding_hosts_remaining() as n1`);
    expect(n1).toBe(49);
  });
});

describe("the practitioner-facing view exposes the right achievement, safely", () => {
  const booking = (status: string, captured: string) => `
    insert into bookings (
      space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
      host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
      credit_applied_cents, total_cents, platform_cents, status, captured_at
    ) values (
      '${SPACE}', '${PRAC}', now() - interval '2 hours', now() - interval '1 hour',
      false, false, 4500, 900, 0, 0, 0, 5400, 900, '${status}', ${captured}
    );`;

  it("counts a completed, captured session and ignores everything else", async () => {
    await db.exec(`
      ${booking("completed", "now()")}                    -- counts
      ${booking("completed", "null")}                     -- ran but never charged
      ${booking("cancelled_by_practitioner", "now()")}    -- cancelled
      ${booking("cancelled_by_host", "null")}             -- cancelled
      ${booking("no_show", "now()")}                      -- no show
      ${booking("upcoming", "null")}                      -- not yet held
    `);

    const [v] = await rows<{ session_milestone: number; founding_host: boolean }>(
      `select session_milestone, founding_host from public_host_profiles where id = '${HOST}'`,
    );
    // Exactly one qualifying session — the first milestone bucket, nothing more.
    expect(v.session_milestone).toBe(1);
    expect(v.founding_host).toBe(false);
  });

  it("moves to the 10 bucket at ten held sessions, and shows founding once earned", async () => {
    await db.exec(`
      insert into bookings (
        space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents, status, captured_at
      )
      select '${SPACE}', '${PRAC}', now() - interval '2 hours', now() - interval '1 hour',
             false, false, 4500, 900, 0, 0, 0, 5400, 900, 'completed', now()
      from generate_series(1, 10);
    `);
    await rows(`select award_founding_host('${HOST}')`);

    const [v] = await rows<{ session_milestone: number; founding_host: boolean }>(
      `select session_milestone, founding_host from public_host_profiles where id = '${HOST}'`,
    );
    expect(v.session_milestone).toBe(10);
    expect(v.founding_host).toBe(true);
  });
});

// A pending listing, ready to be approved. Verified lease already present so the
// only thing the approval changes is the status (and its review stamp).
function pendingSpace(id: string, host: string, name: string): string {
  return `
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${id}', '${host}', '${name}', 'physical', 4500, 3, 'keypad',
      'Panel by the door', '2 Birch Way', 'pending',
      'space/x/lease.pdf', now(), 'pending', null
    );`;
}

/** What the admin route's approval does: pending -> active, in one write. */
const approve = (spaceId: string) =>
  rows(
    `update spaces set status = 'active', sublease_doc_state = 'verified',
       sublease_doc_reviewed_at = now()
     where id = '${spaceId}' and status = 'pending'`,
  );

describe("approval and allocation are one transaction", () => {
  it("awards the spot as the listing goes live, not in a second step", async () => {
    const host = "f0000000-0000-4000-8000-000000000001";
    const space = "f0000000-0000-4000-8000-0000000000a1";
    await rows(`insert into auth.users (id, email) values ('${host}', 'f1@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${host}', 'New Host')`);
    await rows(pendingSpace(space, host, "Fresh room"));

    await approve(space);

    const [p] = await rows<{ founding_number: number | null; status: string }>(
      `select p.founding_number,
              (select status::text from spaces where id = '${space}') as status
       from profiles p where p.id = '${host}'`,
    );
    expect(p.status).toBe("active");
    expect(p.founding_number).toBe(1);
  });

  it("lets the 51st approval succeed with no Founding award — not in the fifty is not an error", async () => {
    await db.exec(`
      insert into auth.users (id, email)
        select ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'g' || n || '@e.com'
        from generate_series(1, 50) n;
      insert into profiles (id, display_name)
        select ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'G' || n
        from generate_series(1, 50) n;
      do $$
      declare i int;
      begin
        for i in 1..50 loop
          perform award_founding_host(('f1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid);
        end loop;
      end $$;
    `);

    const host = "f2000000-0000-4000-8000-000000000051";
    const space = "f2000000-0000-4000-8000-0000000000b1";
    await rows(`insert into auth.users (id, email) values ('${host}', 'g51@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${host}', 'G51')`);
    await rows(pendingSpace(space, host, "Latecomer"));

    await expect(approve(space)).resolves.toBeDefined();

    const [row] = await rows<{ founding_number: number | null; status: string }>(
      `select p.founding_number,
              (select status::text from spaces where id = '${space}') as status
       from profiles p where p.id = '${host}'`,
    );
    expect(row.status).toBe("active"); // the listing is live
    expect(row.founding_number).toBeNull(); // but there was no spot left
  });

  it("does not award on a relist — earned status is never altered later", async () => {
    const host = "f3000000-0000-4000-8000-000000000001";
    const space = "f3000000-0000-4000-8000-0000000000c1";
    await rows(`insert into auth.users (id, email) values ('${host}', 'r@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${host}', 'Relister')`);
    // A previously-approved room, now hidden: verified lease, status delisted.
    await rows(`
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${space}', '${host}', 'Was live', 'physical', 4500, 3, 'keypad',
        'Panel', '3 Cedar St', 'delisted', 'space/x/lease.pdf', now(), 'verified', now()
      );`);

    await rows(`update spaces set status = 'active' where id = '${space}' and status = 'delisted'`);

    const [p] = await rows<{ founding_number: number | null }>(
      `select founding_number from profiles where id = '${host}'`,
    );
    expect(p.founding_number).toBeNull();
  });

  it("cannot partially succeed: if allocation fails, the approval rolls back", async () => {
    const host = "f4000000-0000-4000-8000-000000000001";
    const space = "f4000000-0000-4000-8000-0000000000d1";
    await rows(`insert into auth.users (id, email) values ('${host}', 'p@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${host}', 'Poison')`);
    await rows(pendingSpace(space, host, "Doomed"));

    // A stand-in for a genuine allocation failure: a trigger that raises the
    // moment this host is written a founding number. It fires inside the award,
    // inside the approval's transaction.
    await db.exec(`
      create function poison_founding() returns trigger language plpgsql as $$
      begin
        if new.founding_number is not null then
          raise exception 'poison: allocation blew up';
        end if;
        return new;
      end $$;
      create trigger poison_founding_t before update on profiles
        for each row when (new.id = '${host}') execute function poison_founding();
    `);

    await expect(approve(space)).rejects.toThrow(/poison/i);

    // Neither half stuck: the listing is still pending, the host has no number.
    const [row] = await rows<{ founding_number: number | null; status: string }>(
      `select p.founding_number,
              (select status::text from spaces where id = '${space}') as status
       from profiles p where p.id = '${host}'`,
    );
    expect(row.status).toBe("pending");
    expect(row.founding_number).toBeNull();

    await db.exec(`drop trigger poison_founding_t on profiles; drop function poison_founding();`);
  });
});

describe("the one-time backfill of hosts already live", () => {
  const MIG_0060 = "0060_founding_host.sql";

  /**
   * A database built to just before 0060, seeded, then brought up through 0060 —
   * so its backfill runs against the seeded world, the way it will in production.
   */
  async function withBackfill(seedSql: string): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(read(STUBS));
    for (const m of MIGRATIONS) {
      if (m === MIG_0060) await d.exec(seedSql);
      await d.exec(read(m));
    }
    return d;
  }

  const host = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const space = (n: number, k = 1) =>
    `b1000000-000${k}-4000-8000-${String(n).padStart(12, "0")}`;

  const liveSpace = (id: string, h: string, wentLive: string) => `
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${id}', '${h}', 'Room', 'physical', 4500, 3, 'keypad',
      'Panel', '1 Way', 'active', 'space/x/lease.pdf', now(), 'verified', ${wentLive}
    );`;

  it("orders hosts by when their first listing went live", async () => {
    // Seeded out of order; expected numbering follows the approval times.
    const seed = `
      insert into auth.users (id, email) values
        ('${host(1)}', 'a@e.com'), ('${host(2)}', 'b@e.com'), ('${host(3)}', 'c@e.com');
      insert into profiles (id, display_name) values
        ('${host(1)}', 'A'), ('${host(2)}', 'B'), ('${host(3)}', 'C');
      ${liveSpace(space(1), host(1), "timestamptz '2026-03-01'")}
      ${liveSpace(space(2), host(2), "timestamptz '2026-01-01'")}
      ${liveSpace(space(3), host(3), "timestamptz '2026-02-01'")}
    `;
    const d = await withBackfill(seed);
    const got = await d.query<{ display_name: string; founding_number: number }>(
      `select display_name, founding_number from profiles
       where founding_number is not null order by founding_number`,
    );
    expect(got.rows).toEqual([
      { display_name: "B", founding_number: 1 },
      { display_name: "C", founding_number: 2 },
      { display_name: "A", founding_number: 3 },
    ]);
    await d.close();
  });

  it("gives a host with several live listings exactly one spot", async () => {
    const seed = `
      insert into auth.users (id, email) values ('${host(1)}', 'a@e.com');
      insert into profiles (id, display_name) values ('${host(1)}', 'A');
      ${liveSpace(space(1, 1), host(1), "timestamptz '2026-02-01'")}
      ${liveSpace(space(1, 2), host(1), "timestamptz '2026-01-01'")}
    `;
    const d = await withBackfill(seed);
    const [{ c, num, at }] = (
      await d.query<{ c: number; num: number; at: string }>(
        `select (select count(*) from profiles where founding_number is not null)::int as c,
                founding_number as num, founding_host_at::text as at
         from profiles where id = '${host(1)}'`,
      )
    ).rows;
    expect(c).toBe(1);
    expect(num).toBe(1);
    // The earliest of the host's listings is the moment recorded.
    expect(at).toContain("2026-01-01");
    await d.close();
  });

  it("stops at fifty even with more than fifty qualified hosts", async () => {
    const seed = `
      insert into auth.users (id, email)
        select ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'h' || n || '@e.com'
        from generate_series(1, 55) n;
      insert into profiles (id, display_name)
        select ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'H' || n
        from generate_series(1, 55) n;
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at
      )
      select ('b1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
             ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
             'Room', 'physical', 4500, 3, 'keypad', 'Panel', '1 Way', 'active',
             'space/x/lease.pdf', now(), 'verified', timestamptz '2026-01-01' + (n || ' minutes')::interval
      from generate_series(1, 55) n;
    `;
    const d = await withBackfill(seed);
    const [{ c, top, remaining }] = (
      await d.query<{ c: number; top: number; remaining: number }>(
        `select (select count(*) from profiles where founding_number is not null)::int as c,
                (select coalesce(max(founding_number), 0) from profiles)::int as top,
                founding_hosts_remaining() as remaining`,
      )
    ).rows;
    expect(c).toBe(50);
    expect(top).toBe(50);
    expect(remaining).toBe(0);
    await d.close();
  });

  it("is idempotent — applying 0060 again changes nothing", async () => {
    const seed = `
      insert into auth.users (id, email) values ('${host(1)}', 'a@e.com'), ('${host(2)}', 'b@e.com');
      insert into profiles (id, display_name) values ('${host(1)}', 'A'), ('${host(2)}', 'B');
      ${liveSpace(space(1), host(1), "timestamptz '2026-01-01'")}
      ${liveSpace(space(2), host(2), "timestamptz '2026-02-01'")}
    `;
    const d = await withBackfill(seed);
    const before = (
      await d.query(
        `select id, founding_number, founding_host_at::text as at from profiles
         where founding_number is not null order by founding_number`,
      )
    ).rows;

    await d.exec(read(MIG_0060)); // run the whole migration a second time

    const after = (
      await d.query(
        `select id, founding_number, founding_host_at::text as at from profiles
         where founding_number is not null order by founding_number`,
      )
    ).rows;
    expect(after).toEqual(before);
    await d.close();
  });

  it("leaves an already-numbered host untouched and continues after them", async () => {
    // Host A is numbered by the first backfill. A second qualified host appears
    // later; re-running the backfill must keep A's number and timestamp exactly
    // and give B the next spot, never overwrite or renumber.
    const seed = `
      insert into auth.users (id, email) values ('${host(1)}', 'a@e.com');
      insert into profiles (id, display_name) values ('${host(1)}', 'A');
      ${liveSpace(space(1), host(1), "timestamptz '2026-01-01'")}
    `;
    const d = await withBackfill(seed);
    const [a0] = (
      await d.query<{ num: number; at: string }>(
        `select founding_number as num, founding_host_at::text as at
         from profiles where id = '${host(1)}'`,
      )
    ).rows;
    expect(a0.num).toBe(1);

    // A second qualified host arrives, then the backfill is applied again.
    await d.exec(`
      insert into auth.users (id, email) values ('${host(2)}', 'b@e.com');
      insert into profiles (id, display_name) values ('${host(2)}', 'B');
      ${liveSpace(space(2), host(2), "timestamptz '2026-02-01'")}
    `);
    await d.exec(read(MIG_0060));

    const rows2 = (
      await d.query<{ display_name: string; num: number; at: string }>(
        `select display_name, founding_number as num, founding_host_at::text as at
         from profiles where founding_number is not null order by founding_number`,
      )
    ).rows;
    expect(rows2).toEqual([
      { display_name: "A", num: 1, at: a0.at }, // untouched, same timestamp
      { display_name: "B", num: 2, at: expect.stringContaining("2026-02-01") },
    ]);
    await d.close();
  });
});

describe("remaining is the true global count for every caller", () => {
  // Several hosts, three of them Founding, seeded past the two from beforeEach.
  async function seedThreeFounders(): Promise<{ founder: string; other: string }> {
    const ids = Array.from(
      { length: 5 },
      (_, i) => `a1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    for (const id of ids) {
      await rows(`insert into auth.users (id, email) values ('${id}', '${id}@e.com')`);
      await rows(`insert into profiles (id, display_name) values ('${id}', 'H')`);
    }
    await rows(`select award_founding_host('${ids[0]}')`);
    await rows(`select award_founding_host('${ids[1]}')`);
    await rows(`select award_founding_host('${ids[2]}')`);
    return { founder: ids[0], other: ids[3] };
  }

  it("gives anon, a non-founding user, and a Founding Host the same real number", async () => {
    const { founder, other } = await seedThreeFounders();
    const expected = 50 - 3;

    const [anon] = await asRole<{ n: number }>("anon", "", `select founding_hosts_remaining() as n`);
    const [nonFounder] = await asRole<{ n: number }>(
      "authenticated",
      other,
      `select founding_hosts_remaining() as n`,
    );
    const [asFounder] = await asRole<{ n: number }>(
      "authenticated",
      founder,
      `select founding_hosts_remaining() as n`,
    );

    expect(anon.n).toBe(expected);
    expect(nonFounder.n).toBe(expected);
    expect(asFounder.n).toBe(expected);
  });

  it("does not let the count leak any other profile: RLS still hides them", async () => {
    const { other } = await seedThreeFounders();
    // The real remaining is global, yet a direct read of profiles still shows the
    // caller only their own row — the count came from the definer function, not
    // from any widened access to the table.
    const [{ n }] = await asRole<{ n: number }>(
      "authenticated",
      other,
      `select founding_hosts_remaining() as n`,
    );
    expect(n).toBe(47);

    const own = await asRole<{ id: string }>("authenticated", other, `select id from profiles`);
    expect(own).toHaveLength(1);
    expect(own[0].id).toBe(other);
  });

  it("keeps the ledger itself unreadable to anon and authenticated callers", async () => {
    await seedThreeFounders();
    await expect(
      asRole("authenticated", PRAC, `select * from founding_hosts`),
    ).rejects.toThrow(/permission denied/i);
    await expect(asRole("anon", "", `select * from founding_hosts`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe("a consumed Founding spot is never recycled", () => {
  // n hosts brought live and numbered 1..n via the award function.
  async function awardHosts(n: number): Promise<string[]> {
    const ids = Array.from(
      { length: n },
      (_, i) => `c2000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    for (const id of ids) {
      await rows(`insert into auth.users (id, email) values ('${id}', '${id}@e.com')`);
      await rows(`insert into profiles (id, display_name) values ('${id}', 'H')`);
      await rows(`select award_founding_host('${id}')`);
    }
    return ids;
  }

  it("deleting Founding Host No. 7 does not free number 7 for the next host", async () => {
    const ids = await awardHosts(10);

    // A real account deletion: remove the auth user, which cascades the profile
    // away (this host has no bookings, so nothing blocks it).
    await rows(`delete from auth.users where id = '${ids[6]}'`); // number 7
    expect(await rows(`select 1 from profiles where id = '${ids[6]}'`)).toHaveLength(0);

    // The next host to go live gets 11 — the ledger's high-water mark — never 7.
    const next = "c3000000-0000-4000-8000-000000000001";
    await rows(`insert into auth.users (id, email) values ('${next}', 'n@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${next}', 'Next')`);
    await rows(`select award_founding_host('${next}')`);

    const [p] = await rows<{ num: number }>(
      `select founding_number as num from profiles where id = '${next}'`,
    );
    expect(p.num).toBe(11);
    // Number 7 still belongs to the departed host in the ledger — not reissued.
    const [{ owner }] = await rows<{ owner: string }>(
      `select host_id::text as owner from founding_hosts where founding_number = 7`,
    );
    expect(owner).toBe(ids[6]);
  });

  it("deleting No. 50 does not re-open the fiftieth spot", async () => {
    const ids = await awardHosts(50);
    const [{ before }] = await rows<{ before: number }>(
      `select founding_hosts_remaining() as before`,
    );
    expect(before).toBe(0);

    await rows(`delete from auth.users where id = '${ids[49]}'`); // number 50

    // The spot stays consumed: remaining is still zero, and a new host gets none.
    const [{ after }] = await rows<{ after: number }>(`select founding_hosts_remaining() as after`);
    expect(after).toBe(0);

    const next = "c4000000-0000-4000-8000-000000000001";
    await rows(`insert into auth.users (id, email) values ('${next}', 'n@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${next}', 'Next')`);
    await rows(`select award_founding_host('${next}')`);
    const [p] = await rows<{ num: number | null }>(
      `select founding_number as num from profiles where id = '${next}'`,
    );
    expect(p.num).toBeNull();
  });

  it("never exceeds fifty allocations even after deletions, and approval still succeeds", async () => {
    const ids = await awardHosts(50);
    // Delete a few in the middle.
    await rows(`delete from auth.users where id = '${ids[6]}'`);
    await rows(`delete from auth.users where id = '${ids[20]}'`);

    // A newly qualifying host brings a listing live — approval must succeed with
    // no Founding award, and the ledger must still hold exactly fifty.
    const host = "c5000000-0000-4000-8000-000000000001";
    const space = "c5000000-0000-4000-8000-0000000000f1";
    await rows(`insert into auth.users (id, email) values ('${host}', 'h@e.com')`);
    await rows(`insert into profiles (id, display_name) values ('${host}', 'Latecomer')`);
    await rows(pendingSpace(space, host, "Latecomer"));

    await expect(approve(space)).resolves.toBeDefined();

    const [{ ledger, status }] = await rows<{ ledger: number; status: string }>(
      `select (select count(*) from founding_hosts)::int as ledger,
              (select status::text from spaces where id = '${space}') as status`,
    );
    expect(ledger).toBe(50); // never more than the original fifty
    expect(status).toBe("active"); // and the listing is live regardless
    const [p] = await rows<{ num: number | null }>(
      `select founding_number as num from profiles where id = '${host}'`,
    );
    expect(p.num).toBeNull();
  });
});

describe("a completed, captured session is permanent", () => {
  const held = "d1000000-0000-4000-8000-000000000001";

  async function seedHeldBooking(): Promise<void> {
    await rows(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents, status, captured_at
      ) values (
        '${held}', '${SPACE}', '${PRAC}', now() - interval '2 hours', now() - interval '1 hour',
        false, false, 4500, 900, 0, 0, 0, 5400, 900, 'completed', now()
      )`);
  }

  it("cannot be deleted", async () => {
    await seedHeldBooking();
    await expect(rows(`delete from bookings where id = '${held}'`)).rejects.toThrow(
      /permanent record|cannot be deleted/i,
    );
  });

  it("cannot leave completed or lose its capture", async () => {
    await seedHeldBooking();
    await expect(
      rows(`update bookings set status = 'cancelled_by_host' where id = '${held}'`),
    ).rejects.toThrow(/cannot leave completed/i);
    await expect(
      rows(`update bookings set captured_at = null where id = '${held}'`),
    ).rejects.toThrow(/lose its capture/i);
  });

  it("still allows the writes real flows make — a refund touches neither", async () => {
    await seedHeldBooking();
    await expect(
      rows(`update bookings set refunded_at = now(), refunded_cents = 1000 where id = '${held}'`),
    ).resolves.toBeDefined();
    const [b] = await rows<{ status: string; captured_at: string | null }>(
      `select status::text as status, captured_at from bookings where id = '${held}'`,
    );
    expect(b.status).toBe("completed");
    expect(b.captured_at).not.toBeNull();
  });

  it("cannot be removed by deleting its space or its practitioner (restrict FKs)", async () => {
    await seedHeldBooking();
    await expect(rows(`delete from spaces where id = '${SPACE}'`)).rejects.toThrow(
      /violates RESTRICT|violates foreign key|still referenced/i,
    );
    // Deleting the practitioner's account cascades toward their profile, which the
    // booking's practitioner_id (on delete restrict) refuses.
    await expect(rows(`delete from auth.users where id = '${PRAC}'`)).rejects.toThrow(
      /violates RESTRICT|violates foreign key|still referenced/i,
    );
  });

  it("still lets a fresh, uncaptured hold be rolled back", async () => {
    const hold = "d2000000-0000-4000-8000-000000000001";
    await rows(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents, status, captured_at
      ) values (
        '${hold}', '${SPACE}', '${PRAC}', now() + interval '1 day', now() + interval '25 hours',
        false, false, 4500, 900, 0, 0, 0, 5400, 900, 'upcoming', null
      )`);
    await expect(rows(`delete from bookings where id = '${hold}'`)).resolves.toBeDefined();
  });
});

describe("the SQL and the app agree on the numbers", () => {
  const sql0060 = read("0060_founding_host.sql");

  it("pins the view's milestone buckets to lib/host-achievements", () => {
    // Every threshold the app knows must appear as a bucket in the view, so the
    // public 'highest milestone' can never mean one thing in SQL and another in
    // the badge. A missing or extra threshold here is the drift this guards.
    for (const at of SESSION_MILESTONE_THRESHOLDS) {
      expect(sql0060).toContain(`when n >= ${at} then ${at}`);
    }
    const bucketsInSql = [...sql0060.matchAll(/when n >= (\d+) then \d+/g)].map((m) => Number(m[1]));
    expect(bucketsInSql.sort((a, b) => a - b)).toEqual([...SESSION_MILESTONE_THRESHOLDS]);
  });

  it("pins the cap to lib/founding", () => {
    // The 1..N check and the ceiling test both read the same number the app
    // shows as spots remaining.
    expect(sql0060).toContain(`between 1 and ${FOUNDING_HOST_LIMIT}`);
    expect(sql0060).toContain(`taken >= ${FOUNDING_HOST_LIMIT}`);
    expect(sql0060).toContain(`${FOUNDING_HOST_LIMIT} - (select count(*)`);
  });
});
