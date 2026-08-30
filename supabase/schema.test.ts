import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { indexableCity, indexableCityType, indexablePaths } from "../src/lib/directory";
import { HOST_TERMS_VERSION } from "../src/lib/host-terms";
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
      expect(tables.rows).toHaveLength(18);
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
      // The durable Founding 50 ledger — server-only, so a spot once earned is
      // never re-opened by a deletion (migration 0060).
      "founding_hosts",
      "messages",
      "notifications",
      "profiles",
      // The append-only reward ledger — $25 per qualified referral (0062).
      "referral_rewards",
      "referrals",
      // The server-only referrer ledger — code authority and durable eligibility
      // (migration 0061).
      "referrer_codes",
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
   * The exact location and the way in are both private until a booking is
   * confirmed. A browser gets the coarse point and the area; the street, the
   * precise lat/lng and the entry details come back through
   * space_access_details() once a booking is held (migration 0055).
   */
  it("records the rules acknowledgment and the credential on their rows", async () => {
    // The acknowledgment lives on the booking (migration 0058), stamped at
    // creation, so a dispute can point to it beside the declared purpose.
    const bookingCols = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'bookings'`,
    );
    expect(bookingCols.map((c) => c.column_name)).toContain("rules_ack_at");

    // The credential fields live on the profile, beside insurance.
    const profileCols = (
      await rows<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'`,
      )
    ).map((c) => c.column_name);
    for (const col of [
      "credential_doc_path",
      "credential_doc_state",
      "credential_doc_reviewed_at",
      "credential_type",
      "credential_number",
      "credential_jurisdiction",
      "credential_review_note",
    ]) {
      expect(profileCols, col).toContain(col);
    }
  });

  it("omits the exact location and the way in from spaces_public", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'spaces_public'`,
    );
    const names = columns.map((c) => c.column_name);

    expect(names).not.toContain("entry_instructions");
    expect(names).not.toContain("sublease_doc_path");
    expect(names).not.toContain("insurance_doc_path");

    // Only the coarse point and area are published, so a room can be placed but
    // not found. The address_line/lat/lng column names survive as NULL for a
    // safe rollout (migration 0055 header); that they carry no data is asserted
    // by value below.
    expect(names).toContain("approx_lat");
    expect(names).toContain("approx_lng");
    expect(names).toContain("area");

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

    // Only the name, the avatar, and the two safe host signals: whether the
    // host is Founding (a boolean), and their highest session milestone (a
    // bucket, never the raw count). No Stripe id, no document path, no email,
    // no verdict — see migration 0060.
    expect(columns.map((c) => c.column_name).sort()).toEqual([
      "avatar_path",
      "display_name",
      "founding_host",
      "id",
      "session_milestone",
    ]);
  });

  it("runs per-user views as the caller and public views as the definer", async () => {
    // Both halves matter. A per-user view without security_invoker bypasses
    // RLS and hands every practitioner's balance to whoever asks. A public
    // subset view *with* it errors instead, because anon holds no grant on
    // the base table — safety there comes from the column list, not from RLS.
    //
    // "Public" here means definer, not anonymously readable. Migration 0064
    // closed the per-listing definer views (spaces_public, public_host_profiles,
    // availability_public, space_media_public, public_reviews, space_ratings) to
    // anon while leaving the aggregate ones open; who may read each is asserted
    // by role in rls.test.ts. This test is only about definer vs invoker.
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
      // The category-level aggregate (0064), so the public directory's category
      // filter never has to read a per-listing view. A room has one category, so
      // the count is exact and still reveals nothing about an individual room.
      "city_category_inventory",
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

/**
 * Listing photographs are not world-readable (migration 0064).
 *
 * Closing the views is only half the boundary: while the bucket was public, an
 * object was fetchable by anyone who had, or guessed, its path — no view needed.
 * So the bucket is private and the blanket public-read policy is replaced with
 * one only a signed-in caller matches. A structural check, because the storage
 * fetch path is not exercised in PGlite; the functional contract is that the
 * app signs its own URLs (supabase-repository) and anon holds no read policy.
 */
describe("space media is not world-readable", () => {
  it("makes the space-media bucket private", async () => {
    const [bucket] = await rows<{ public: boolean }>(
      `select public from storage.buckets where id = 'space-media'`,
    );
    expect(bucket.public).toBe(false);
  });

  it("leaves no client read policy on space-media", async () => {
    // 0064's world-readable policy is gone and its broken replacement was
    // dropped in 0065 with nothing to take its place. Listing media is read only
    // through the server signing route, which uses the service role — so no
    // storage.objects SELECT policy is needed, and none exists. Anon, and every
    // client, can therefore read no listing media directly.
    const selects = await rows<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'space-media:%' and cmd = 'SELECT'`,
    );
    expect(selects).toEqual([]);
  });

  it("keeps the host write, update and delete policies untouched", async () => {
    const cmds = (
      await rows<{ cmd: string }>(
        `select cmd from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'space-media:%'`,
      )
    )
      .map((p) => p.cmd)
      .sort();
    // The three from 0017, and no SELECT among them.
    expect(cmds).toEqual(["DELETE", "INSERT", "UPDATE"]);
  });

  it("has no storage read policy that subqueries spaces", async () => {
    // The architecture rule: authorising media by listing lives in the server
    // route, never in a storage policy subquery against spaces/spaces_public —
    // which is subject to spaces' owner-only RLS and cannot clear a practitioner
    // (0017's note, confirmed by 0064). No storage SELECT policy may reference
    // either.
    const selects = await rows<{ qual: string | null }>(
      `select qual from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'`,
    );
    for (const policy of selects) {
      expect(policy.qual ?? "").not.toMatch(/\bspaces\b|spaces_public/);
    }
  });
});

/**
 * 0066 (the card variant) is an expand-only migration, so it is safe to apply
 * before the new code deploys — the currently deployed code keeps working
 * against a database that has the extra column. This pins the two properties
 * that make that true, so a later change cannot quietly turn the migration into
 * a breaking one.
 */
describe("the card_path migration is backward-compatible", () => {
  it("adds card_path as a nullable column, so old inserts that omit it still work", async () => {
    const [column] = await rows<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns
       where table_name = 'space_media' and column_name = 'card_path'`,
    );
    expect(column.is_nullable).toBe("YES");
    expect(column.column_default).toBeNull();
  });

  it("widens space_media_public to a superset the old client still reads via select(*)", async () => {
    const columns = (
      await rows<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'space_media_public'`,
      )
    )
      .map((c) => c.column_name)
      .sort();
    // The original 0002 columns, plus card_path — nothing removed or renamed, so
    // old code selecting * gets everything it did and one column it ignores.
    expect(columns).toEqual(["card_path", "id", "kind", "position", "space_id", "storage_path"]);
  });
});

/**
 * Before a booking, spaces_public carries only a coarse point and the area —
 * never the exact address or the precise coordinates. The exact location coming
 * back once a booking is held is proven end to end against space_access_details
 * in rls.test.ts (a signed-in stranger is refused; the booker gets the street);
 * this asserts the public view is coarse in the first place (migration 0055).
 */
describe("location is coarse in spaces_public", () => {
  const host = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const spaceId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const exactLat = 37.5629;
  const exactLng = -122.3255;

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${host}', 'coarse-host@example.com');
      insert into profiles (id, display_name) values ('${host}', 'Coarse Host');
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, lat, lng, sublease_doc_path, legal_ack_at,
        status, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${spaceId}', '${host}', 'Cedar', 'physical', 4500, 3, 'keypad',
        'Code 4417, then the blue door', '742 Evergreen Terrace, San Mateo, CA 94402',
        ${exactLat}, ${exactLng}, 'space/x/lease.pdf', now(),
        'active', 'verified', now()
      );
    `);
  });

  it("publishes only an offset point and an area, never the exact location", async () => {
    const [row] = await rows<{
      approx_lat: number;
      approx_lng: number;
      area: string | null;
      address_line: string | null;
      lat: number | null;
      lng: number | null;
    }>(
      `select approx_lat, approx_lng, area, address_line, lat, lng
       from spaces_public where id = '${spaceId}'`,
    );
    expect(row.approx_lat).not.toBeNull();
    expect(row.approx_lng).not.toBeNull();
    // Moved off the building: the offset is 250-450m, so the published point is
    // never the real one, but still in the same neighbourhood.
    expect(row.approx_lat !== exactLat || row.approx_lng !== exactLng).toBe(true);
    expect(Math.abs(row.approx_lat - exactLat)).toBeLessThan(0.01);
    expect(Math.abs(row.approx_lng - exactLng)).toBeLessThan(0.01);
    // The area is the town, not the street number.
    expect(row.area ?? "").not.toContain("742");
    // The deprecated columns exist for rollout safety but carry no exact data,
    // even though the base row has all three.
    expect(row.address_line).toBeNull();
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
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

    // Three active rooms, which is also the floor at which a price is published
    // at all (0064 withholds a min/median/max below three, so it can never be an
    // individual host's rate). The point here is that pending and delisted rooms
    // count towards neither the number nor the statistics.
    await db.exec(add("active", 3000));
    await db.exec(add("active", 4000));
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

    expect(belmont.space_count).toBe(3);
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

describe("0052 — the Host Terms are versioned the same on both sides", () => {
  /*
   * The client checks HOST_TERMS_VERSION to decide whether to ask a host to
   * accept again; the acceptance trigger stamps required_host_terms_version()
   * as the value recorded. They are the same fact read from two sides, so if
   * they disagree a host could be asked for one version and have another
   * written — this pins them together, and fails whichever bumps without the
   * other.
   */
  it("keeps HOST_TERMS_VERSION equal to required_host_terms_version()", async () => {
    const [row] = await rows<{ version: number }>(`select required_host_terms_version() as version`);
    expect(row.version).toBe(HOST_TERMS_VERSION);
  });

  /*
   * CASE D: the migration adds the columns null and backfills nothing. An
   * account that existed before the Host Terms carries no acceptance it never
   * made — the record exists precisely so it cannot claim one.
   */
  it("leaves existing accounts with no acceptance", async () => {
    const host = await hostFor("Grandfathered Studio");
    const [row] = await rows<{ v: number | null; at: string | null }>(
      `select host_terms_version as v, host_terms_accepted_at as at
       from profiles where id = '${host}'`,
    );
    expect(row.v).toBeNull();
    expect(row.at).toBeNull();
  });

  /*
   * And an existing listing keeps running. The gate is on INSERT, so a space
   * that was live before the Host Terms stays live and editable regardless of
   * whether its host has accepted them yet.
   */
  it("does not disturb a listing whose host has not accepted", async () => {
    const host = await hostFor("Still Live Studio");
    await db.exec(`
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '0000d052-0000-4000-8000-000000000001', '${host}', 'Live', 'physical', 4200, 2,
        'keypad', 'By the door', '3 Old Road', 'active',
        'space/o/lease.pdf', now(), 'verified', now()
      );
    `);
    await db.exec(
      `update spaces set hourly_rate_cents = 4300
       where id = '0000d052-0000-4000-8000-000000000001'`,
    );
    const [row] = await rows<{ status: string; rate: number }>(
      `select status, hourly_rate_cents as rate from spaces
       where id = '0000d052-0000-4000-8000-000000000001'`,
    );
    expect(row.status).toBe("active");
    expect(row.rate).toBe(4300);
  });
});
