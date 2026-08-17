import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { indexableCity, indexableCityType, indexablePaths } from "../src/lib/directory";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the migrations against a real Postgres (PGlite, compiled to WASM) so
 * the DDL is executed rather than eyeballed. There is no live Supabase project
 * yet, and a schema that only looks right is not worth much when the first
 * thing it does in production is take money.
 *
 * `0000_supabase_stubs.sql` stands in for what Supabase provides — auth.users,
 * storage.*, auth.uid() — and is deliberately excluded from MIGRATIONS so it
 * can never be mistaken for something to apply to the real project.
 */
/**
 * Read from the directory, not written down.
 *
 * This was a hand-maintained list and it stopped at 0007, so six migrations —
 * everything from map positions through reviews and account types — were never
 * executed by any test. One of them could not be applied twice: it dropped a
 * view that another view depended on, which fails on every re-run and did,
 * against the live project, because nothing here had tried.
 *
 * A list that must be updated by hand is a list that will be out of date, and
 * silently: the suite stays green while covering less and less.
 */
const STUBS = "0000_supabase_stubs.sql";

const migrationsDir = join(import.meta.dirname, "migrations");

const MIGRATIONS = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of MIGRATIONS) {
    await db.exec(read(migration));
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const result = await db.query<T>(sql, params as never[]);
  return result.rows;
}

/**
 * A host to hang test listings off, since `spaces.host_id` references one.
 *
 * Its own row each time, so a test that inserts four rooms cannot be read as
 * one host with four rooms by a later test that counts them.
 */
let hostSeq = 0;
async function hostFor(name: string): Promise<string> {
  hostSeq += 1;
  const id = `000000ff-0000-4000-8000-${String(hostSeq).padStart(12, "0")}`;
  await db.exec(`insert into auth.users (id) values ('${id}') on conflict do nothing`);
  await db.exec(
    `insert into profiles (id, display_name) values ('${id}', '${name}') on conflict do nothing`,
  );
  return id;
}

describe("migrations apply cleanly", () => {
  it("survives being applied a second time", async () => {
    /**
     * Pasting the whole script into a project that already has most of it
     * should be dull. Before this, it aborted on `create type space_category`
     * at line 16 and left the operator guessing which half had landed —
     * which is exactly what happened in practice.
     */
    const fresh = new PGlite();
    try {
      await fresh.exec(read(STUBS));
      for (const migration of MIGRATIONS) await fresh.exec(read(migration));
      for (const migration of MIGRATIONS) await fresh.exec(read(migration));

      const tables = await fresh.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      expect(tables.rows).toHaveLength(14);
    } finally {
      await fresh.close();
    }
  }, 60_000);

  /**
   * The second run, against a database somebody has been using.
   *
   * The test above re-applies the script to an empty database, which is not
   * the case that breaks. This one puts in the rows a real account produces
   * first, and it reproduces a failure that stopped the live project dead:
   * 0011 adds a strict E.164 check on the emergency contact number, 0021
   * repeals it because it rejected "0533 395 5823" and every other way a
   * person writes a partner's number — and on the second pass 0011 met a row
   * saved under the newer rule and aborted the entire file, taking every
   * migration after it down too.
   *
   * The general shape is worth guarding, not just this constraint: any rule a
   * later migration repeals will meet data that predates its repeal, and the
   * script has to survive that.
   */
  it("survives a second run against rows a real account would have", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(read(STUBS));
      for (const migration of MIGRATIONS) await fresh.exec(read(migration));

      const person = "11111111-1111-1111-1111-111111111111";
      await fresh.exec(`insert into auth.users (id) values ('${person}')`);
      await fresh.exec(
        `insert into profiles (id, emergency_contact_name, emergency_contact_phone)
         values ('${person}', 'Partner', '0533 395 5823')`,
      );

      for (const migration of MIGRATIONS) await fresh.exec(read(migration));

      const [row] = (
        await fresh.query<{ emergency_contact_phone: string }>(
          `select emergency_contact_phone from profiles where id = '${person}'`,
        )
      ).rows;
      expect(row.emergency_contact_phone).toBe("0533 395 5823");
    } finally {
      await fresh.close();
    }
  }, 60_000);

  it("creates every table the app expects", async () => {
    const found = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );

    expect(found.map((r) => r.table_name)).toEqual([
      "account_type_change_requests",
      "availability",
      "bookings",
      "credit_ledger",
      "messages",
      "notifications",
      "profiles",
      "refund_requests",
      "review_escalations",
      "reviews",
      "space_media",
      // What somebody searched for when nothing came back — see 0044. Insert
      // only: there is no select policy at all, so not even a signed-in
      // account can read a row.
      "space_requests",
      "spaces",
      "studio_claims",
    ]);
  });

  /**
   * Every irreversible movement of money keeps a pointer to the thing that
   * moved it.
   *
   * An upheld claim charged a card and stored only the amount, which is the
   * one case that had to be found by hand: nothing failed, the money arrived,
   * and there was simply no way afterwards to answer a bank asking which
   * charge we were talking about.
   */
  it("keeps a Stripe id beside every amount it moves", async () => {
    const missing = await rows<{ table_name: string }>(
      `select t.table_name
       from (values ('bookings'), ('studio_claims')) as t(table_name)
       where not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = t.table_name
           and c.column_name = 'stripe_payment_intent_id'
       )`,
    );

    expect(missing).toEqual([]);
  });

  it("grants service_role access to every table the server writes", async () => {
    /**
     * This is the check that was missing. A policy without a GRANT is dead
     * code, and BYPASSRLS does not help a role that cannot touch the table at
     * all — service_role authenticated perfectly while every REST call came
     * back denied, which reads exactly like a bad key.
     */
    const ungranted = await rows<{ table_name: string }>(
      `select t.table_name
       from information_schema.tables t
       where t.table_schema = 'public'
         and t.table_type = 'BASE TABLE'
         and not exists (
           select 1 from information_schema.role_table_grants g
           where g.table_schema = 'public'
             and g.table_name = t.table_name
             and g.grantee = 'service_role'
             and g.privilege_type = 'INSERT'
         )
       order by t.table_name`,
    );

    expect(ungranted).toEqual([]);
  });

  it("still refuses anon everything on the base tables", async () => {
    // Widening service_role must not have widened anon along with it.
    const granted = await rows<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
         and table_name in ('profiles','spaces','bookings','credit_ledger','availability','space_media')`,
    );

    expect(granted).toEqual([]);
  });

  it("enables row level security on every table", async () => {
    const unprotected = await rows<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and rowsecurity = false`,
    );

    expect(unprotected).toEqual([]);
  });
});

/**
 * What a booking insert must supply.
 *
 * `credit_applied_cents` was not-null with no default and the insert in
 * booking-service.ts never mentioned it, so every booking ever attempted
 * through the API died on a constraint the type system could not see. Nothing
 * caught it: the column exists, the code compiles, and the failure only
 * happens against a real Postgres.
 *
 * So the list is written down. Add a required column to `bookings` and this
 * fails, naming the insert that has to learn about it.
 */
describe("a booking row can actually be written", () => {
  it("requires exactly the columns booking-service supplies", async () => {
    const required = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'bookings'
         and is_nullable = 'NO' and column_default is null
       order by column_name`,
    );

    // Every one of these is named in the insert in src/lib/booking-service.ts.
    expect(required.map((c) => c.column_name)).toEqual([
      "credit_applied_cents",
      "ends_at",
      "host_rate_cents",
      "instant_fee_cents",
      "is_instant",
      "platform_cents",
      "practitioner_id",
      "pro_discount_cents",
      "service_fee_cents",
      "space_id",
      "starts_at",
      "total_cents",
      "was_pro",
    ]);
  });
});

describe("private columns stay out of the public views", () => {
  /**
   * The line moved, and it moved on purpose.
   *
   * The address used to be here, on the grounds that a room should not be
   * findable before it is booked. Every listing is a retail studio whose
   * address is on Google Maps already, so that withheld nothing and cost the
   * practitioner the fact they decide on. What is still private is the way in.
   */
  it("omits the way in from spaces_public", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'spaces_public'`,
    );
    const names = columns.map((c) => c.column_name);

    expect(names).not.toContain("entry_instructions");
    expect(names).not.toContain("sublease_doc_path");
    expect(names).not.toContain("insurance_doc_path");

    // Published now, and the reason is in the migration rather than here.
    expect(names).toContain("address_line");
    expect(names).toContain("lat");
    expect(names).toContain("lng");

    // Still has to be useful for Discover.
    expect(names).toContain("hourly_rate_cents");
    expect(names).toContain("category");

    // House rules are shown before booking, not after. A grip-socks
    // requirement discovered on arrival is the same broken promise as a fee
    // that appears at checkout.
    expect(names).toContain("requirements");
    expect(names).toContain("house_rules");

    /*
     * Without this the hours are meaningless and nothing says so. The client
     * reads this view with `select *`, so a missing column arrives as
     * undefined and falls back to Pacific — every room on one clock, no error
     * anywhere, and bookings refused for rooms that are genuinely open.
     */
    expect(names).toContain("timezone");
  });

  it("omits Stripe identifiers and document paths from public_host_profiles", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'public_host_profiles'`,
    );

    expect(columns.map((c) => c.column_name).sort()).toEqual([
      "avatar_path",
      "display_name",
      "id",
    ]);
  });

  it("runs per-user views as the caller and public views as the definer", async () => {
    // Both halves matter. A per-user view without security_invoker bypasses
    // RLS and hands every practitioner's balance to whoever asks. A public
    // subset view *with* it errors instead, because anon holds no grant on
    // the base table — safety there comes from the column list, not from RLS.
    const PER_USER = [
      "credit_balances",
      "bookings_with_access_code",
      "messages_visible",
      /*
       * Notification history. Invoker, so the row policy scopes it to the
       * recipient — and the grant behind it is column-level, because a
       * blanket select would have let somebody skip the view and read
       * last_error, attempts and dedupe_key straight off the table. The view
       * is the presentation; the grant is the boundary.
       */
      "my_notifications",
    ];
    const PUBLIC = [
      "spaces_public",
      "public_host_profiles",
      "availability_public",
      "space_media_public",
      // Reviews are shown to everyone, so the same rule applies: the safety
      // of a definer view is its column list, and the author's identity, the
      // booking and the safety flag are absent from both of these.
      "public_reviews",
      "space_ratings",
      /*
       * How many rooms are bookable in each town, and what they cost.
       *
       * Public because the pages built on them are: a search engine reaches
       * those signed out, which is the whole reason they exist. They aggregate
       * the same rows spaces_public shows, under the same `status = 'active'`
       * filter, so they can reveal nothing a listing does not already publish
       * on its own page — a count, a range, and a median of prices that are
       * public one at a time.
       */
      "city_inventory",
      "city_type_inventory",
      /*
       * The demand counts. Public because a host is shown them, and safe to
       * be public because it is counts: no email, no id, no row. The table
       * underneath is readable by nobody, which is the point of the view
       * existing at all.
       */
      "space_demand",
    ];

    /**
     * A third kind, and the one easiest to get wrong.
     *
     * Definer, like the public views, so it can read base tables the caller
     * has no grant on — but its rows are not public. It filters itself down to
     * auth.uid() in the view body, because a definer view applies no row
     * policy and a missing filter would hand every signed-in account everyone
     * else's total. That total divides straight back into how many sessions
     * somebody has had.
     *
     * Listed separately so the filter is asserted rather than assumed.
     */
    const SELF_FILTERED = ["session_counts"];

    const views = await rows<{ viewname: string; options: string[] | null }>(
      `select c.relname as viewname, c.reloptions as options
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'`,
    );
    const optionsFor = (name: string) =>
      views.find((v) => v.viewname === name)?.options ?? [];

    expect(views.map((v) => v.viewname).sort()).toEqual(
      [...PER_USER, ...PUBLIC, ...SELF_FILTERED].sort(),
    );

    for (const name of PER_USER) {
      expect(optionsFor(name), `${name} must be security_invoker`).toContain(
        "security_invoker=true",
      );
    }
    for (const name of [...PUBLIC, ...SELF_FILTERED]) {
      expect(optionsFor(name), `${name} must not be security_invoker`).not.toContain(
        "security_invoker=true",
      );
    }
  });

  it("exposes the address only through a security definer function", async () => {
    const [fn] = await rows<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'space_access_details'`,
    );

    expect(fn.prosecdef).toBe(true);
    // A definer function without a pinned search_path is a privilege
    // escalation waiting to happen.
    expect(fn.proconfig ?? []).toContain("search_path=public");
  });
});

describe("money and scheduling constraints", () => {
  const aUser = "11111111-1111-1111-1111-111111111111";

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${aUser}', 'host@example.com');
      insert into profiles (id, display_name) values ('${aUser}', 'Test Host');
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity,
        access_type, entry_instructions, address_line, sublease_doc_path, legal_ack_at
      ) values (
        '22222222-2222-2222-2222-222222222222', '${aUser}', 'Willow', 'physical',
        4500, 3, 'keypad', 'Code is on the door panel', '1 Test St', 'space/x/lease.pdf', now()
      );
    `);
  });

  it("rejects a zero or negative hourly rate", async () => {
    await expect(
      db.exec(`
        insert into spaces (
          host_id, name, category, hourly_rate_cents, capacity,
          access_type, entry_instructions, address_line, sublease_doc_path, legal_ack_at
        ) values (
          '${aUser}', 'Free room', 'physical', 0, 2,
          'keypad', 'n/a', '2 Test St', 'space/x/lease.pdf', now()
        );
      `),
    ).rejects.toThrow();
  });

  it("rejects an availability block that ends before it starts", async () => {
    await expect(
      db.exec(`
        insert into availability (space_id, weekday, start_minute, end_minute)
        values ('22222222-2222-2222-2222-222222222222', 1, 1020, 540);
      `),
    ).rejects.toThrow();
  });

  it("accepts several blocks on the same weekday", async () => {
    // The brief's own example: Monday 7-8am, 2-3pm and 5-9pm.
    await db.exec(`
      insert into availability (space_id, weekday, start_minute, end_minute) values
        ('22222222-2222-2222-2222-222222222222', 1, 420, 480),
        ('22222222-2222-2222-2222-222222222222', 1, 840, 900),
        ('22222222-2222-2222-2222-222222222222', 1, 1020, 1260);
    `);

    const monday = await rows(
      `select start_minute from availability
       where space_id = '22222222-2222-2222-2222-222222222222' and weekday = 1
       order by start_minute`,
    );

    expect(monday).toHaveLength(3);
  });

  it("rejects a booking that ends before it starts", async () => {
    await expect(
      db.exec(`
        insert into bookings (
          space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
          host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
          credit_applied_cents, total_cents, platform_cents
        ) values (
          '22222222-2222-2222-2222-222222222222', '${aUser}',
          now() + interval '2 hours', now() + interval '1 hour',
          false, false, 4500, 900, 0, 0, 0, 5400, 900
        );
      `),
    ).rejects.toThrow();
  });

  it("rejects a half-recorded cancellation", async () => {
    // cancelled_at without cancelled_by would leave us unable to tell whether
    // the practitioner or the host walked away, which decides who gets charged.
    await expect(
      db.exec(`
        insert into bookings (
          space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
          host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
          credit_applied_cents, total_cents, platform_cents, cancelled_at
        ) values (
          '22222222-2222-2222-2222-222222222222', '${aUser}',
          now() + interval '1 hour', now() + interval '2 hours',
          false, false, 4500, 900, 0, 0, 0, 5400, 900, now()
        );
      `),
    ).rejects.toThrow();
  });

  it("refuses to delete a space that has bookings against it", async () => {
    await db.exec(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents
      ) values (
        '33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', '${aUser}',
        now() + interval '1 hour', now() + interval '2 hours',
        false, false, 4500, 900, 0, 0, 0, 5400, 900
      );
    `);

    await expect(
      db.exec(`delete from spaces where id = '22222222-2222-2222-2222-222222222222';`),
    ).rejects.toThrow();
  });

  it("derives the credit balance as a sum of deltas", async () => {
    await db.exec(`
      insert into credit_ledger (practitioner_id, delta_cents, reason) values
        ('${aUser}', 900, 'host_cancellation'),
        ('${aUser}', -734, 'booking_redemption'),
        ('${aUser}', 166, 'host_cancellation');
    `);

    const [balance] = await rows<{ balance_cents: number }>(
      `select balance_cents from credit_balances where practitioner_id = '${aUser}'`,
    );

    expect(balance.balance_cents).toBe(332);
  });
});
/**
 * 0043 — the two axes every generated page is built on.
 *
 * The town, and what a room is bookable for. Neither was stored: `spaces` had
 * an address string and four coarse categories, and "the pilates rooms in San
 * Mateo" is not a question either can answer. These columns are what make a
 * page like that generable at all — so what is checked here is that they
 * exist, that they can be grouped by, and that adding them did not quietly
 * widen what the public can see.
 */
describe("0043 — where a space is and what it suits", () => {
  it("stores the town, the state and the postcode as columns", async () => {
    const columns = await rows<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_name = 'spaces'
         and column_name in ('city', 'state', 'postal_code', 'suitable_for')
       order by column_name`,
    );

    expect(columns.map((c) => c.column_name)).toEqual([
      "city",
      "postal_code",
      "state",
      "suitable_for",
    ]);
    // An array, because a room is bookable for more than one thing — which is
    // also what puts one listing on several city pages.
    expect(columns.find((c) => c.column_name === "suitable_for")?.data_type).toBe("ARRAY");
  });

  /**
   * The uses are constrained, and that is the point rather than an oversight.
   *
   * Every value in this column becomes a URL segment. A typo reaching it is a
   * page that quietly splits the traffic of a real one, and nothing about a
   * text[] would ever object — so the database objects, and adding a use is a
   * migration on purpose. src/lib/space-types.test.ts holds the other half:
   * that the list here and the list the app offers are the same list.
   */
  it("refuses a use that is not on the list", async () => {
    const host = await hostFor("Constraint Host");

    const insert = (uses: string) => `
      insert into spaces (
        host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, sublease_doc_path, legal_ack_at,
        timezone, suitable_for
      ) values (
        '${host}', 'Room', 'physical', 4000, 3, 'keypad', 'Side door',
        '1 Test St, San Mateo, CA 94404, USA', 'lease.pdf', now(),
        'America/Los_Angeles', ${uses}
      )`;

    await expect(db.exec(insert("array['therapy-office']"))).rejects.toThrow();
    await expect(db.exec(insert("array['pilates-studio', 'yoga-studio']"))).resolves.toBeDefined();
  });

  /**
   * Both indexes are partial on `status = 'active'`.
   *
   * Every query that will use them is a public page asking what is bookable in
   * a town, and a pending or delisted room is never part of that answer. A
   * partial index also stays small as rejected listings accumulate — which
   * they do, and which the pages never look at.
   */
  it("indexes what the pages filter on", async () => {
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where tablename = 'spaces'
         and indexname in ('spaces_active_place_idx', 'spaces_active_suitable_for_idx')
       order by indexname`,
    );

    expect(indexes.map((i) => i.indexname)).toEqual([
      "spaces_active_place_idx",
      "spaces_active_suitable_for_idx",
    ]);
    for (const index of indexes) {
      expect(index.indexdef, index.indexname).toContain("status = 'active'");
    }
  });

  /**
   * The count the indexing rule reads.
   *
   * A city page is only worth indexing when there is something on it. Thin
   * pages are how programmatic SEO fails: a thousand near-empty addresses
   * teach a search engine that the site is mostly nothing, and that judgement
   * lands on the pages that are not. The count lives in the database so the
   * sitemap, the page's own robots tag and the internal links all read one
   * number — three separate counts drift, and it surfaces as a sitemap
   * advertising pages that tell the crawler to go away.
   */
  it("counts only what somebody could actually book", async () => {
    const host = await hostFor("Inventory Host");

    const add = (status: string, cents: number) => `
      insert into spaces (
        host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, sublease_doc_path, legal_ack_at,
        timezone, city, state, suitable_for, status,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${host}', 'Room', 'physical', ${cents}, 3, 'keypad', 'Side door',
        '1 Test St', 'lease.pdf', now(), 'America/Los_Angeles',
        'Belmont', 'CA', array['pilates-studio'], '${status}',
        -- 0018 refuses an active listing whose lease has not been checked,
        -- which is the rule that keeps unreviewed rooms out of Discover. A
        -- test row is a listing like any other and has to satisfy it.
        'verified', now()
      )`;

    await db.exec(add("active", 3000));
    await db.exec(add("active", 5000));
    // Neither of these can be booked, so neither belongs on a page.
    await db.exec(add("pending", 9900));
    await db.exec(add("delisted", 100));

    const [belmont] = await rows<{
      space_count: number;
      median_cents: number;
      max_cents: number;
    }>(
      `select space_count, median_cents, max_cents from city_inventory
       where city = 'Belmont' and state = 'CA'`,
    );

    expect(belmont.space_count).toBe(2);
    // The pending room is the expensive one. A page quoting it would be
    // quoting a price nobody can pay.
    expect(belmont.max_cents).toBe(5000);
    expect(belmont.median_cents).toBe(4000);
  });

  it("puts a room on a page for every use it is marked for", async () => {
    const host = await hostFor("Multi Use Host");
    await db.exec(`
      insert into spaces (
        host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, sublease_doc_path, legal_ack_at,
        timezone, city, state, suitable_for, status,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${host}', 'Both', 'physical', 4000, 3, 'keypad', 'Side door',
        '2 Test St', 'lease.pdf', now(), 'America/Los_Angeles',
        'Foster City', 'CA', array['pilates-studio', 'yoga-studio'], 'active', 'verified', now()
      )`);

    const counts = await rows<{ space_type: string; space_count: number }>(
      `select space_type, space_count from city_type_inventory
       where city = 'Foster City' order by space_type`,
    );

    // One room, two pages. This is the reason the column is an array: at this
    // stage, pages per listing is the number that matters.
    expect(counts).toEqual([
      { space_type: "pilates-studio", space_count: 1 },
      { space_type: "yoga-studio", space_count: 1 },
    ]);
  });

  /**
   * A room the geocoder could not place is on no page rather than a wrong one.
   *
   * Nothing derives a town from the address string, which is what makes this
   * safe: the comma you would have to count on is the one that moves.
   */
  it("leaves a room with no town off the city pages entirely", async () => {
    const host = await hostFor("Placeless Host");
    await db.exec(`
      insert into spaces (
        host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, sublease_doc_path, legal_ack_at,
        timezone, status, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${host}', 'Nowhere', 'physical', 4000, 3, 'keypad', 'Side door',
        'A place with no comma', 'lease.pdf', now(), 'America/Los_Angeles',
        'active', 'verified', now()
      )`);

    expect(await rows("select * from city_inventory where city is null")).toEqual([]);
  });
});


/**
 * The indexing rule, against real rows rather than hand-written ones.
 *
 * src/lib/directory.test.ts checks the rule as arithmetic. This checks the
 * other half — that the numbers it is given are the numbers the database
 * actually produces — because a threshold applied to a miscounted total is a
 * rule that is right about the wrong thing. The two failures that matter are
 * both invisible: a town advertised with less in it than we thought, and a use
 * page that turns out to be its parent under another address.
 */
describe("the indexing rule, on rows the database produced", () => {
  it("holds a town back until it has enough, then lets it through", async () => {
    const host = await hostFor("Threshold Host");

    const add = (city: string, uses: string) => `
      insert into spaces (
        host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, sublease_doc_path, legal_ack_at,
        timezone, city, state, suitable_for, status,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${host}', 'Room', 'physical', 4000, 3, 'keypad', 'Side door',
        '1 Test St', 'lease.pdf', now(), 'America/Los_Angeles',
        '${city}', 'CA', ${uses}, 'active', 'verified', now()
      )`;

    // Two is below the threshold of three.
    await db.exec(add("Atherton", "array['pilates-studio']"));
    await db.exec(add("Atherton", "array['pilates-studio']"));

    const under = await rows<{ space_count: number }>(
      `select space_count from city_inventory where city = 'Atherton'`,
    );
    expect(indexableCity({ spaceCount: under[0].space_count })).toBe(false);

    await db.exec(add("Atherton", "array['pilates-studio']"));

    const over = await rows<{ space_count: number }>(
      `select space_count from city_inventory where city = 'Atherton'`,
    );
    expect(over[0].space_count).toBe(3);
    expect(indexableCity({ spaceCount: over[0].space_count })).toBe(true);
  });

  /*
   * The duplicate that is easy to ship. Every room in Atherton is a pilates
   * studio, so the use page lists exactly what the town page lists — one page,
   * two addresses, and a search engine picking between them.
   */
  it("refuses a use page that is its own town page", async () => {
    const [town] = await rows<{ space_count: number }>(
      `select space_count from city_inventory where city = 'Atherton'`,
    );
    const [use] = await rows<{ space_count: number; space_type: string }>(
      `select space_count, space_type from city_type_inventory
       where city = 'Atherton' and space_type = 'pilates-studio'`,
    );

    expect(use.space_count).toBe(town.space_count);
    expect(
      indexableCityType(
        {
          state: "CA",
          city: "Atherton",
          spaceType: use.space_type,
          spaceCount: use.space_count,
          minCents: 0,
          maxCents: 0,
          medianCents: 0,
        },
        town.space_count,
      ),
    ).toBe(false);
  });

  /*
   * And lets it through once it is a genuine subset — which is what happens
   * the moment the town has a room that is something else.
   */
  it("allows it once the town has more than that one use", async () => {
    const host = await hostFor("Mixed Host");
    for (let i = 0; i < 3; i++) {
      await db.exec(`
        insert into spaces (
          host_id, name, category, hourly_rate_cents, capacity, access_type,
          entry_instructions, address_line, sublease_doc_path, legal_ack_at,
          timezone, city, state, suitable_for, status,
          sublease_doc_state, sublease_doc_reviewed_at
        ) values (
          '${host}', 'Couch Room', 'traditional', 5000, 2, 'keypad', 'Side door',
          '2 Test St', 'lease.pdf', now(), 'America/Los_Angeles',
          'Atherton', 'CA', array['massage-room'], 'active', 'verified', now()
        )`);
    }

    const [town] = await rows<{ space_count: number }>(
      `select space_count from city_inventory where city = 'Atherton'`,
    );
    const [use] = await rows<{ space_count: number }>(
      `select space_count from city_type_inventory
       where city = 'Atherton' and space_type = 'pilates-studio'`,
    );

    expect(town.space_count).toBe(6);
    expect(use.space_count).toBe(3);
    expect(
      indexableCityType(
        {
          state: "CA",
          city: "Atherton",
          spaceType: "pilates-studio",
          spaceCount: use.space_count,
          minCents: 0,
          maxCents: 0,
          medianCents: 0,
        },
        town.space_count,
      ),
    ).toBe(true);
  });

  /*
   * The whole engine, end to end: rows in, addresses out. The town, and the
   * two uses that are each a real subset of it — and nothing else.
   */
  it("produces exactly the addresses those rows earn", async () => {
    const cities = (
      await rows<{ state: string; city: string; space_count: number }>(
        `select state, city, space_count from city_inventory where city = 'Atherton'`,
      )
    ).map((r) => ({
      state: r.state,
      city: r.city,
      spaceCount: r.space_count,
      minCents: 0,
      maxCents: 0,
      medianCents: 0,
    }));

    const types = (
      await rows<{ state: string; city: string; space_type: string; space_count: number }>(
        `select state, city, space_type, space_count from city_type_inventory
         where city = 'Atherton'`,
      )
    ).map((r) => ({
      state: r.state,
      city: r.city,
      spaceType: r.space_type,
      spaceCount: r.space_count,
      minCents: 0,
      maxCents: 0,
      medianCents: 0,
    }));

    expect(indexablePaths(cities, types)).toEqual([
      "/spaces/ca/atherton",
      "/spaces/ca/atherton/massage-room",
      "/spaces/ca/atherton/pilates-studio",
    ]);
  });
});
