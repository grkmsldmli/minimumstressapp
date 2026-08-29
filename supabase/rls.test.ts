import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Exercises the RLS policies as real users rather than asserting they exist.
 *
 * `schema.test.ts` proves the migrations apply; this proves they protect
 * anything. Both are needed: a policy with no matching GRANT is refused before
 * RLS is consulted, and a view without security_invoker bypasses RLS entirely
 * — neither shows up in a structural check.
 *
 * PGlite connects as superuser, which bypasses RLS, so every assertion runs
 * inside `asUser()` / `asAnon()` to drop into the role Supabase would use.
 */
const migrationsDir = join(import.meta.dirname, "migrations");
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const HOST = "11111111-1111-1111-1111-111111111111";
const PRACTITIONER = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const SPACE = "44444444-4444-4444-4444-444444444444";
const PENDING_SPACE = "55555555-5555-5555-5555-555555555555";

/**
 * A second studio owner, with a live room and money of their own.
 *
 * Every two-party test until now ran HOST against PRACTITIONER or against
 * STRANGER, and a stranger is the easy adversary: they hold nothing, so any
 * policy that checks anything at all stops them. A rival host is the hard one.
 * They legitimately reach every host surface — host_bookings(), their own
 * spaces, their own earnings — so a leak here comes from a function that
 * forgot to scope by owner rather than from a missing policy.
 *
 * It is also the shape the product is about to take. Everything has been
 * exercised with one room owned by one person.
 */
// Deliberately outside the digit runs: the blocks further down declare
// their own fixtures locally, and 6666/8888 are already taken there.
const RIVAL_HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RIVAL_SPACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let db: PGlite;

/**
 * Runs `sql` as the given role with the given JWT subject.
 *
 * The transaction is load-bearing. SET LOCAL only survives the current
 * transaction, and PGlite auto-commits each statement, so setting the role in
 * one call and querying in the next runs the query back as superuser — which
 * bypasses RLS entirely and makes every policy look like it passes. Keeping
 * both inside one transaction is the only way these assertions mean anything.
 */
async function runAs<T = Record<string, unknown>>(
  role: "authenticated" | "anon",
  userId: string,
  sql: string,
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`
      set local role ${role};
      select set_config('request.jwt.claim.sub', '${userId}', true);
    `);
    const result = await tx.query<T>(sql);
    return result.rows;
  }) as Promise<T[]>;
}

const asUser = <T = Record<string, unknown>>(userId: string, sql: string) =>
  runAs<T>("authenticated", userId, sql);

const asAnon = <T = Record<string, unknown>>(sql: string) => runAs<T>("anon", "", sql);

/** Guards against the harness silently reverting to superuser again. */
async function currentRole(userId: string): Promise<string> {
  const [row] = await asUser<{ who: string }>(userId, `select current_user::text as who`);
  return row.who;
}

beforeAll(async () => {
  db = new PGlite();
  /*
   * Read from disk, in order. This was a written-out list that stopped at
   * 0007, so every policy added after that — reviews, account types, points —
   * was absent from the database these tests query. They passed by asking
   * questions about tables that were not there.
   *
   * The stubs come first and are not a migration: they stand in for what
   * Supabase provides.
   */
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await db.exec(read(file));
  }

  await db.exec(`
    insert into auth.users (id, email) values
      ('${HOST}', 'host@example.com'),
      ('${PRACTITIONER}', 'practitioner@example.com'),
      ('${STRANGER}', 'stranger@example.com'),
      ('${RIVAL_HOST}', 'rival@example.com');

    insert into profiles (id, display_name, stripe_customer_id) values
      ('${HOST}', 'Willow Studio', 'cus_host'),
      ('${PRACTITIONER}', 'Elena R.', 'cus_prac'),
      ('${STRANGER}', 'Nosy Parker', 'cus_stranger'),
      ('${RIVAL_HOST}', 'Cedar Rooms', 'cus_rival');

    -- A live listing carries a verified lease, which 0018 now enforces on the
    -- row. Seeding one without it used to be possible and is the exact state
    -- that constraint exists to prevent.
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values
      ('${SPACE}', '${HOST}', 'Willow', 'physical', 4500, 3, 'keypad',
       'Panel to the left of the blue door', '12 Alder Lane', 'active',
       'space/x/lease.pdf', now(), 'verified', now()),
      ('${PENDING_SPACE}', '${HOST}', 'Not Yet Live', 'spirit', 2600, 6, 'lockbox',
       'Lockbox under the bench', '9 Hidden Way', 'pending',
       'space/y/lease.pdf', now(), 'pending', null),
      ('${RIVAL_SPACE}', '${RIVAL_HOST}', 'Cedar Room', 'social', 5200, 4, 'greeter',
       'Ring the bell marked 3C', '40 Cedar Street', 'active',
       'space/r/lease.pdf', now(), 'verified', now());

    -- One paid booking for PRACTITIONER, already past its reveal time.
    -- captured_at is what makes it a booking rather than a held hour, which
    -- is the distinction 0038 draws for the host's side.
    insert into bookings (
      space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
      host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
      credit_applied_cents, total_cents, platform_cents,
      access_code, access_code_revealed_at, captured_at
    ) values (
      '${SPACE}', '${PRACTITIONER}',
      now() + interval '20 minutes', now() + interval '80 minutes',
      true, false, 4500, 900, 500, 0, 0, 5900, 1400,
      '4821', now() - interval '10 minutes', now() - interval '1 hour'
    );


    insert into credit_ledger (practitioner_id, delta_cents, reason) values
      ('${PRACTITIONER}', 900, 'host_cancellation'),
      ('${STRANGER}', 5000, 'host_cancellation');
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the harness itself", () => {
  it("actually drops to the authenticated role", async () => {
    // If this regresses to 'postgres', every other assertion in this file is
    // meaningless: superuser bypasses RLS and all the policies appear to pass.
    expect(await currentRole(PRACTITIONER)).toBe("authenticated");
  });

  it("resolves auth.uid() from the impersonated subject", async () => {
    const [row] = await asUser<{ uid: string }>(PRACTITIONER, `select auth.uid()::text as uid`);
    expect(row.uid).toBe(PRACTITIONER);
  });
});

describe("the exact address is private until booked", () => {
  /**
   * Before a booking, a browser learns only roughly where a room is — the area
   * and a point offset a few hundred metres (migration 0055). The exact street,
   * the precise coordinates and the way inside belong to whoever paid for the
   * hour, and come back through space_access_details().
   */
  it("gives a signed-in browser no exact location", async () => {
    // spaces_public is closed to anon since 0064, so the marketplace user is who
    // reads it — and even they get only the coarse projection.
    const [space] = await asUser<{
      address_line: string | null;
      lat: number | null;
      lng: number | null;
      entry_instructions?: string;
    }>(STRANGER, `select * from spaces_public where id = '${SPACE}'`);

    // The exact street and precise point are NULL shims, kept only so the
    // previously deployed client's select does not error mid rollout (migration
    // 0055); entry instructions are not in the view at all.
    expect(space.address_line).toBeNull();
    expect(space.lat).toBeNull();
    expect(space.lng).toBeNull();
    expect(space.entry_instructions).toBeUndefined();
  });

  it("never publishes the entry instructions", async () => {
    const columns = await asUser(STRANGER, `select * from spaces_public where id = '${SPACE}'`);

    expect(columns).toHaveLength(1);
    expect(Object.keys(columns[0])).not.toContain("entry_instructions");
  });

  it("refuses anonymous access to the spaces table entirely", async () => {
    await expect(asAnon(`select address_line from spaces where id = '${SPACE}'`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("withholds the entry instructions from somebody who has not booked", async () => {
    const found = await asUser(
      STRANGER,
      `select entry_instructions from space_access_details('${SPACE}')`,
    );

    expect(found).toEqual([]);
  });

  it("releases it to a practitioner who has booked", async () => {
    const [details] = await asUser<{ address_line: string; entry_instructions: string }>(
      PRACTITIONER,
      `select address_line, entry_instructions from space_access_details('${SPACE}')`,
    );

    expect(details.address_line).toBe("12 Alder Lane");
    expect(details.entry_instructions).toBe("Panel to the left of the blue door");
  });

  it("refuses the reveal function to an anonymous caller", async () => {
    await expect(
      asAnon(`select address_line from space_access_details('${SPACE}')`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("still lets the host see their own listing's address", async () => {
    const [space] = await asUser<{ address_line: string }>(
      HOST,
      `select address_line from spaces where id = '${SPACE}'`,
    );

    expect(space.address_line).toBe("12 Alder Lane");
  });
});

describe("listings that are not live stay hidden", () => {
  it("keeps a pending space out of the public view", async () => {
    const found = await asUser(STRANGER, `select id from spaces_public where id = '${PENDING_SPACE}'`);
    expect(found).toEqual([]);
  });

  it("still shows the host their own pending space", async () => {
    const found = await asUser(HOST, `select id from spaces where id = '${PENDING_SPACE}'`);
    expect(found).toHaveLength(1);
  });
});

/**
 * Individual inventory is inside the signed-in marketplace (migration 0064).
 *
 * The marketing site is anonymous; the app is signed in. So `anon` may read
 * only the aggregate inventory — where the marketplace operates and roughly
 * what it costs — and no per-listing projection or host profile. A signed-in
 * marketplace user still reads all of it, which is what keeps Discover working.
 * This is the boundary the whole privacy change turns on, asserted as the two
 * roles rather than trusted to a grant nobody exercises.
 */
describe("the public inventory views are closed to anonymous visitors", () => {
  const PER_LISTING = [
    "spaces_public",
    "space_media_public",
    "availability_public",
    "space_ratings",
    "public_reviews",
    "public_host_profiles",
  ];

  for (const view of PER_LISTING) {
    it(`refuses anonymous select on ${view}`, async () => {
      await expect(asAnon(`select * from ${view} limit 1`)).rejects.toThrow(/permission denied/i);
    });

    it(`still lets a signed-in marketplace user read ${view}`, async () => {
      // Not throwing is the assertion; the row set may legitimately be empty.
      await expect(asUser(STRANGER, `select * from ${view} limit 1`)).resolves.toBeDefined();
    });
  }

  const AGGREGATE = [
    "city_inventory",
    "city_type_inventory",
    "city_category_inventory",
    "space_demand",
  ];

  for (const view of AGGREGATE) {
    it(`still lets an anonymous visitor read the aggregate ${view}`, async () => {
      await expect(asAnon(`select * from ${view} limit 1`)).resolves.toBeDefined();
    });
  }
});

describe("bookings are visible only to the two parties", () => {
  it("lets the practitioner read their own booking", async () => {
    const found = await asUser(PRACTITIONER, `select id from bookings`);
    expect(found).toHaveLength(1);
  });

  it("lets the host read bookings on their space", async () => {
    const found = await asUser(HOST, `select id from bookings`);
    expect(found).toHaveLength(1);
  });

  it("shows an unrelated user nothing", async () => {
    const found = await asUser(STRANGER, `select id from bookings`);
    expect(found).toEqual([]);
  });

  it("refuses a client-side insert, since bookings must move money atomically", async () => {
    await expect(
      asUser(
        PRACTITIONER,
        `insert into bookings (
           space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
           host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
           credit_applied_cents, total_cents, platform_cents
         ) values (
           '${SPACE}', '${PRACTITIONER}', now() + interval '3 hours',
           now() + interval '4 hours', false, false, 4500, 900, 0, 0, 0, 5400, 900
         )`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("the access code is withheld, not merely hidden", () => {
  it("gives the code to its practitioner once the reveal time has passed", async () => {
    const [booking] = await asUser<{ revealed_access_code: string | null }>(
      PRACTITIONER,
      `select revealed_access_code from bookings_with_access_code`,
    );

    expect(booking.revealed_access_code).toBe("4821");
  });

  it("withholds it before the reveal time", async () => {
    await db.exec(
      `update bookings set access_code_revealed_at = now() + interval '25 minutes'`,
    );

    const [booking] = await asUser<{ revealed_access_code: string | null }>(
      PRACTITIONER,
      `select revealed_access_code from bookings_with_access_code`,
    );

    expect(booking.revealed_access_code).toBeNull();

    await db.exec(
      `update bookings set access_code_revealed_at = now() - interval '10 minutes'`,
    );
  });

  it("never gives the code to the host, who set the instructions but not the code", async () => {
    const [booking] = await asUser<{ revealed_access_code: string | null }>(
      HOST,
      `select revealed_access_code from bookings_with_access_code`,
    );

    expect(booking.revealed_access_code).toBeNull();
  });

  /**
   * A cancelled session is not one to walk into.
   *
   * The view asked only who was asking and whether the reveal time had passed,
   * and cancelBooking never cleared the code — so a booking cancelled after
   * the reveal kept a working door code indefinitely, and a host cancelling on
   * somebody left it with them.
   */
  it.each([
    ["cancelled_by_practitioner", "practitioner"],
    ["cancelled_by_host", "host"],
  ])("takes the code back when the booking is %s", async (status, by) => {
      // bookings_cancellation_consistent wants all three together, which is
      // the constraint doing its job: a cancelled row with no hand on it.
      await db.exec(
        `update bookings set status = '${status}', cancelled_at = now(), cancelled_by = '${by}'`,
      );

      const [booking] = await asUser<{ revealed_access_code: string | null }>(
        PRACTITIONER,
        `select revealed_access_code from bookings_with_access_code`,
      );

      expect(booking.revealed_access_code).toBeNull();

      await db.exec(
        `update bookings set status = 'upcoming', cancelled_at = null, cancelled_by = null`,
      );
  });

  /**
   * A held hour is not a booking. An abandoned checkout sits at 'upcoming'
   * until the sweep reaches it, and it was being handed a code for a room
   * nobody had paid for.
   */
  it("withholds the code from an hour that was never paid for", async () => {
    await db.exec(`update bookings set captured_at = null`);

    const [booking] = await asUser<{ revealed_access_code: string | null }>(
      PRACTITIONER,
      `select revealed_access_code from bookings_with_access_code`,
    );

    expect(booking.revealed_access_code).toBeNull();

    await db.exec(`update bookings set captured_at = now() - interval '1 hour'`);
  });
});

/**
 * The address, the entry instructions and how the door works.
 *
 * Status and the 24-hour window were already checked here, which is why
 * cancelling took these away. Payment was not, so an abandoned checkout could
 * read its way into the building while it waited to be swept.
 */
describe("entry instructions need a paid booking", () => {
  const details = (user: string) =>
    asUser<{ entry_instructions: string }>(
      user,
      `select entry_instructions from space_access_details('${SPACE}')`,
    );

  it("gives them to the practitioner who paid", async () => {
    const rows = await details(PRACTITIONER);
    expect(rows[0]?.entry_instructions).toMatch(/blue door/i);
  });

  it("withholds them from an hour that was never paid for", async () => {
    await db.exec(`update bookings set captured_at = null`);

    expect(await details(PRACTITIONER)).toHaveLength(0);

    await db.exec(`update bookings set captured_at = now() - interval '1 hour'`);
  });

  it("withholds them from somebody with no booking at all", async () => {
    expect(await details(STRANGER)).toHaveLength(0);
  });
});

describe("credit balances are per-practitioner", () => {
  it("shows a practitioner only their own balance", async () => {
    const balances = await asUser<{ balance_cents: number }>(
      PRACTITIONER,
      `select balance_cents from credit_balances`,
    );

    expect(balances).toEqual([{ balance_cents: 900 }]);
  });

  it("does not leak another practitioner's balance through the aggregate view", async () => {
    // The view groups across the whole ledger, so without security_invoker
    // this would return both rows regardless of who is asking.
    const balances = await asUser(STRANGER, `select balance_cents from credit_balances`);

    expect(balances).toEqual([{ balance_cents: 5000 }]);
  });

  it("refuses a client-side ledger write", async () => {
    await expect(
      asUser(
        STRANGER,
        `insert into credit_ledger (practitioner_id, delta_cents, reason)
         values ('${STRANGER}', 999999, 'host_cancellation')`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("profiles keep their payment identifiers to themselves", () => {
  it("lets a user read their own row", async () => {
    const found = await asUser(HOST, `select stripe_customer_id from profiles`);
    expect(found).toEqual([{ stripe_customer_id: "cus_host" }]);
  });

  it("hides other users' rows entirely", async () => {
    const found = await asUser(STRANGER, `select id from profiles where id = '${HOST}'`);
    expect(found).toEqual([]);
  });

  it("exposes only name, avatar and the two safe host signals", async () => {
    // public_host_profiles is closed to anon since 0064; a signed-in browser is
    // who reads it, and still sees only the safe columns.
    const [host] = await asUser(STRANGER, `select * from public_host_profiles where id = '${HOST}'`);
    // Name, avatar, whether they are Founding (a boolean), and their highest
    // session milestone (a bucket, not the raw count). Nothing private —
    // migration 0060.
    expect(Object.keys(host).sort()).toEqual([
      "avatar_path",
      "display_name",
      "founding_host",
      "id",
      "session_milestone",
    ]);
  });

  it("gives a practitioner no public presence at all", async () => {
    // The view is named for hosts but originally returned every profile, so a
    // practitioner's name and photo were readable by any signed-in caller.
    const found = await asUser(
      STRANGER,
      `select id from public_host_profiles where id = '${PRACTITIONER}'`,
    );
    expect(found).toEqual([]);
  });

  it("still lets a host see who booked their own space", async () => {
    // 0004 removed the practitioner's public identity, so this is the only
    // remaining path to that name — and it exists precisely because the host
    // is entitled to know who is coming into their room.
    const rows = await asUser<{ practitioner_name: string; net_cents: number }>(
      HOST,
      `select practitioner_name, net_cents from host_bookings()`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].practitioner_name).toBe("Elena R.");
    expect(rows[0].net_cents).toBe(4500);
  });

  /**
   * A checkout nobody paid for, which is what 0038 is about.
   *
   * Closing the card form put a session on a studio's calendar for the thirty
   * minutes before the reaper reached it, and the host had no way to learn it
   * had gone again. The hour genuinely is held underneath — the availability
   * check excludes anything upcoming, so nobody quicker can take it from the
   * person still at the card form — but a held hour is not a booking.
   *
   * Written and removed inside the test rather than added to the fixture: the
   * counts in the suite above are assertions of their own, and a second row
   * appearing in them would be this test breaking those instead of proving
   * itself.
   */
  it("keeps a checkout nobody paid for off the host's calendar", async () => {
    await db.exec(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents, access_code
      ) values (
        '99999999-9999-4999-8999-999999999999',
        '${SPACE}', '${PRACTITIONER}',
        now() + interval '3 days', now() + interval '3 days 1 hour',
        false, false, 4500, 900, 0, 0, 0, 5400, 900, '9999'
      );
    `);

    try {
      const rows = await asUser<{ booking_id: string }>(
        HOST,
        `select booking_id from host_bookings()`,
      );

      expect(rows.map((r) => r.booking_id)).not.toContain(
        "99999999-9999-4999-8999-999999999999",
      );
      expect(rows).toHaveLength(1);
    } finally {
      await db.exec(
        `delete from bookings where id = '99999999-9999-4999-8999-999999999999'`,
      );
    }
  });

  it("shows a host nothing for spaces they do not own", async () => {
    const rows = await asUser(STRANGER, `select booking_id from host_bookings()`);
    expect(rows).toEqual([]);
  });

  it("never exposes the platform's cut to a host", async () => {
    /*
     * Hosts see earnings, never a percentage. Keeping the fee columns out of
     * the signature means even a careless `select *` cannot leak them.
     *
     * The list is exact rather than a check for absent names, so adding any
     * column to this function has to come past this test. `host_paid_at` did:
     * it says when a transfer landed, which is the host's own money and their
     * own question, and carries no amount at all. The trust columns (0057) did
     * too — a profession, three booleans and a plain session count, none of
     * them a fee, an amount, a document, or contact detail.
     */
    const [row] = await asUser<Record<string, unknown>>(HOST, `select * from host_bookings()`);

    expect(Object.keys(row)).toEqual([
      "booking_id",
      "space_id",
      "starts_at",
      "ends_at",
      "status",
      "net_cents",
      "practitioner_name",
      "practitioner_avatar_path",
      "host_paid_at",
      "practitioner_profession",
      "practitioner_identity_verified",
      "practitioner_insurance_verified",
      "practitioner_credential_reviewed",
      "practitioner_completed_sessions",
      "practitioner_good_standing",
    ]);
  });

  /** The new column is a time, and a time cannot carry an amount. */
  it("says when a payout landed without saying what the platform kept", async () => {
    const [row] = await asUser<Record<string, unknown>>(
      HOST,
      `select * from host_bookings()`,
    );

    expect(row).toHaveProperty("host_paid_at");
    for (const leak of ["platform_cents", "service_fee_cents", "total_cents", "instant_fee_cents"]) {
      expect(Object.keys(row)).not.toContain(leak);
    }
  });

  it("drops a host from public view once they have no live listing", async () => {
    await db.exec(`update spaces set status = 'delisted' where host_id = '${HOST}'`);
    const afterDelisting = await asUser(
      STRANGER,
      `select id from public_host_profiles where id = '${HOST}'`,
    );
    await db.exec(`update spaces set status = 'active' where id = '${SPACE}'`);

    expect(afterDelisting).toEqual([]);
  });

  it("stops a user editing someone else's profile", async () => {
    await asUser(STRANGER, `update profiles set display_name = 'Hacked' where id = '${HOST}'`);

    const [host] = await asUser<{ display_name: string }>(
      HOST,
      `select display_name from profiles`,
    );
    expect(host.display_name).toBe("Willow Studio");
  });
});

describe("hosts can only manage their own listings", () => {
  it("stops a stranger editing someone else's space", async () => {
    await asUser(STRANGER, `update spaces set hourly_rate_cents = 1 where id = '${SPACE}'`);

    const [space] = await asUser<{ hourly_rate_cents: number }>(
      HOST,
      `select hourly_rate_cents from spaces where id = '${SPACE}'`,
    );
    expect(space.hourly_rate_cents).toBe(4500);
  });

  it("stops a stranger claiming a space as their own", async () => {
    await expect(
      asUser(
        STRANGER,
        `insert into spaces (
           host_id, name, category, hourly_rate_cents, capacity, access_type,
           entry_instructions, address_line, sublease_doc_path, legal_ack_at
         ) values (
           '${HOST}', 'Stolen', 'physical', 9900, 2, 'keypad',
           'x', 'y', 'z', now()
         )`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("stops a stranger opening hours on someone else's space", async () => {
    await expect(
      asUser(
        STRANGER,
        `insert into availability (space_id, weekday, start_minute, end_minute)
         values ('${SPACE}', 1, 540, 1020)`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("lets the real host open hours, and anyone browsing then see them", async () => {
    await asUser(
      HOST,
      `insert into availability (space_id, weekday, start_minute, end_minute)
       values ('${SPACE}', 1, 540, 1020)`,
    );

    // availability_public is closed to anon since 0064; the signed-in browser sees it.
    const found = await asUser(STRANGER, `select id from availability_public where space_id = '${SPACE}'`);
    expect(found).toHaveLength(1);
  });

  it("keeps a pending space's hours out of the public schedule", async () => {
    await asUser(
      HOST,
      `insert into availability (space_id, weekday, start_minute, end_minute)
       values ('${PENDING_SPACE}', 2, 540, 1020)`,
    );

    const found = await asUser(
      STRANGER,
      `select id from availability_public where space_id = '${PENDING_SPACE}'`,
    );
    expect(found).toEqual([]);
  });

  it("refuses anonymous access to the availability table itself", async () => {
    await expect(asAnon(`select id from availability`)).rejects.toThrow(/permission denied/i);
  });
});

/**
 * The points view is a security definer view, so no row policy applies to it.
 * Its only protection is the filter written into the view body — which makes
 * it exactly the kind of thing that looks fine in review and leaks everything.
 */
describe("session counts are your own", () => {
  it("shows a practitioner their own total", async () => {
    const rows = await asUser<{ user_id: string }>(
      PRACTITIONER,
      `select user_id::text from session_counts`,
    );

    // Whatever the total is, every row returned must belong to the caller.
    for (const row of rows) expect(row.user_id).toBe(PRACTITIONER);
  });

  it("never shows one account another's total", async () => {
    const rows = await asUser<{ user_id: string }>(
      HOST,
      `select user_id::text from session_counts`,
    );

    expect(rows.every((r) => r.user_id === HOST)).toBe(true);
    expect(rows.some((r) => r.user_id === PRACTITIONER)).toBe(false);
  });

  /** Asking for somebody else by name must not work around the filter. */
  it("returns nothing when asked for another account by id", async () => {
    const rows = await asUser(
      HOST,
      `select sessions from session_counts where user_id = '${PRACTITIONER}'`,
    );

    expect(rows).toHaveLength(0);
  });

  it("gives an anonymous caller nothing at all", async () => {
    await expect(asAnon(`select sessions from session_counts`)).rejects.toThrow();
  });
});

/**
 * A thread belongs to a booking, and a booking has exactly two people on it.
 *
 * The interesting case is the stranger: nothing about a message says who may
 * read it, so the whole protection is the participant check, and a policy that
 * merely looks right here would expose every conversation on the platform.
 */
describe("messages stay inside their booking", () => {
  const bookingId = async () => {
    const [row] = await asUser<{ id: string }>(
      PRACTITIONER,
      `select id::text from bookings limit 1`,
    );
    return row.id;
  };

  beforeAll(async () => {
    const [row] = await asUser<{ id: string }>(
      PRACTITIONER,
      `select id::text from bookings limit 1`,
    );

    // Written as the service role, the way the send route does it.
    await db.exec(`
      insert into messages (booking_id, sender_id, body)
      values ('${row.id}', '${PRACTITIONER}', 'Is there parking nearby?');
    `);
  });

  it("lets the practitioner read the thread", async () => {
    const rows = await asUser(PRACTITIONER, `select body from messages_visible`);
    expect(rows).toHaveLength(1);
  });

  it("lets the host read the same thread", async () => {
    const rows = await asUser(HOST, `select body from messages_visible`);
    expect(rows).toHaveLength(1);
  });

  it("shows a stranger nothing", async () => {
    const rows = await asUser(STRANGER, `select body from messages_visible`);
    expect(rows).toHaveLength(0);
  });

  it("shows an anonymous caller nothing", async () => {
    await expect(asAnon(`select body from messages_visible`)).rejects.toThrow();
  });

  /**
   * The masked text is what the recipient gets; the original is for staff
   * handling a complaint. A view that exposed both would make the masking
   * pointless.
   */
  it("keeps the unmasked original out of the view", async () => {
    await expect(
      asUser(PRACTITIONER, `select original_body from messages_visible`),
    ).rejects.toThrow();
  });

  it("does not let a stranger write into somebody else's thread", async () => {
    const id = await bookingId();
    await expect(
      asUser(
        STRANGER,
        `insert into messages (booking_id, sender_id, body)
         values ('${id}', '${STRANGER}', 'let me in')`,
      ),
    ).rejects.toThrow();
  });

  /** Nobody inserts directly — the route masks first, then writes as staff. */
  it("does not let a participant write directly either", async () => {
    const id = await bookingId();
    await expect(
      asUser(
        PRACTITIONER,
        `insert into messages (booking_id, sender_id, body)
         values ('${id}', '${PRACTITIONER}', 'call me on 415 555 0134')`,
      ),
    ).rejects.toThrow();
  });
});

/**
 * Editing a listing, and the one sentence underneath every rule here: a change
 * must never rewrite something somebody has already agreed to.
 */
describe("what a host may change on a listing", () => {
  it("lets them fix the things that only describe the room", async () => {
    await asUser(
      HOST,
      `update spaces set name = 'Willow Room', entry_instructions = 'Now the green door',
         capacity = 4, buffer_minutes = 20 where id = '${PENDING_SPACE}'`,
    );

    const [space] = await asUser<{ name: string; capacity: number }>(
      HOST,
      `select name, capacity from spaces where id = '${PENDING_SPACE}'`,
    );
    expect(space.name).toBe("Willow Room");
    expect(space.capacity).toBe(4);
  });

  /**
   * A booking froze its own money when it was made, so a rate change cannot
   * reach one that already exists. Which is why this one needs no ceremony.
   */
  it("lets them change the rate without disturbing the listing", async () => {
    await asUser(HOST, `update spaces set hourly_rate_cents = 5200 where id = '${SPACE}'`);

    const [space] = await asUser<{ hourly_rate_cents: number; status: string }>(
      HOST,
      `select hourly_rate_cents, status from spaces where id = '${SPACE}'`,
    );
    expect(space.hourly_rate_cents).toBe(5200);
    expect(space.status).toBe("active");
  });

  /**
   * Somebody has arranged their day around a room at that address. Moving it
   * underneath them is the harm the cancellation policy exists to prevent,
   * done quietly instead of with a notification.
   */
  it("refuses to move a space that has sessions booked", async () => {
    await expect(
      asUser(HOST, `update spaces set address_line = '99 Elsewhere' where id = '${SPACE}'`),
    ).rejects.toThrow(/upcoming session/i);
  });

  it("refuses to change the room type out from under a booking", async () => {
    await expect(
      asUser(HOST, `update spaces set category = 'spirit' where id = '${SPACE}'`),
    ).rejects.toThrow(/upcoming session/i);
  });

  it("allows the move once nothing is booked", async () => {
    await asUser(
      HOST,
      `update spaces set address_line = '7 New Street' where id = '${PENDING_SPACE}'`,
    );

    const [space] = await asUser<{ address_line: string }>(
      HOST,
      `select address_line from spaces where id = '${PENDING_SPACE}'`,
    );
    expect(space.address_line).toBe("7 New Street");
  });

  /**
   * A move that only changes the string is the bug this guards.
   *
   * 0019 granted `lat` and `lng` with the address. `map_x`/`map_y` came in
   * 0008, after the blanket update had been revoked and re-granted column by
   * column, so the edit could carry the new coordinates and then be refused
   * the two that decide where the pin sits on the browse map — leaving a
   * listing reading one city and drawn in another. 0037 grants them.
   */
  it("lets the coordinates and the browse pin move with the address", async () => {
    await asUser(
      HOST,
      `update spaces
          set address_line = '400 Market Street', lat = 37.7936, lng = -122.3965,
              map_x = 71.4, map_y = 33.8
        where id = '${PENDING_SPACE}'`,
    );

    const [space] = await asUser<{
      lat: number;
      lng: number;
      map_x: string;
      map_y: string;
    }>(HOST, `select lat, lng, map_x, map_y from spaces where id = '${PENDING_SPACE}'`);

    expect(space.lat).toBeCloseTo(37.7936);
    expect(space.lng).toBeCloseTo(-122.3965);
    expect(Number(space.map_x)).toBe(71.4);
    expect(Number(space.map_y)).toBe(33.8);
  });

  /**
   * We verified a particular lease for a particular address. Changing either
   * means what was checked is not what is listed, so it comes off search until
   * somebody has looked again — and the document state goes back with it,
   * since leaving it verified is how a listing goes live with a lease for
   * somewhere else.
   */
  it("sends a moved listing back for review, document state and all", async () => {
    // Staff approve, as they do in the app — a host cannot reach these columns,
    // which the last test in this block is about.
    await db.exec(
      `update spaces set status = 'active', sublease_doc_state = 'verified',
         sublease_doc_reviewed_at = now() where id = '${PENDING_SPACE}'`,
    );
    await asUser(
      HOST,
      `update spaces set address_line = '8 Another Road' where id = '${PENDING_SPACE}'`,
    );

    const [space] = await asUser<{
      status: string;
      sublease_doc_state: string;
      sublease_doc_reviewed_at: string | null;
    }>(
      HOST,
      `select status, sublease_doc_state, sublease_doc_reviewed_at
         from spaces where id = '${PENDING_SPACE}'`,
    );
    expect(space.status).toBe("pending");
    expect(space.sublease_doc_state).toBe("pending");
    expect(space.sublease_doc_reviewed_at).toBeNull();
  });

  it("re-reviews a replaced sublease document even if nothing else moved", async () => {
    await asUser(
      HOST,
      `update spaces set sublease_doc_path = 'space/z/new-lease.pdf' where id = '${SPACE}'`,
    );

    const [space] = await asUser<{ status: string; sublease_doc_state: string }>(
      HOST,
      `select status, sublease_doc_state from spaces where id = '${SPACE}'`,
    );
    expect(space.status).toBe("pending");
    expect(space.sublease_doc_state).toBe("pending");
  });

  /** A host approving their own listing is the whole review, skipped. */
  it("refuses to let a host switch their own listing on", async () => {
    await expect(
      asUser(HOST, `update spaces set status = 'active' where id = '${SPACE}'`),
    ).rejects.toThrow(/permission denied/i);
  });
});

/**
 * Both sides can read the same booking row, for different reasons, and an
 * app that forgets which side it is on reads it from the wrong one.
 */
describe("the two sides of one booking", () => {
  it("lets a host see bookings on their own space", async () => {
    const found = await asUser(HOST, `select id from bookings where space_id = '${SPACE}'`);
    expect(found.length).toBeGreaterThan(0);
  });

  /**
   * Which is why "my bookings" has to say whose.
   *
   * The host policy is correct and deliberate — it is how their calendar
   * works — so a query that means "sessions I booked" cannot lean on row
   * security to filter for it. It has to ask. The app's own list did not,
   * and showed a host somebody else's session in their room as though the
   * host had booked it.
   */
  it("distinguishes booked-by-me from booked-in-my-space", async () => {
    const asPractitioner = await asUser(
      PRACTITIONER,
      `select id from bookings where practitioner_id = auth.uid()`,
    );
    const hostAsPractitioner = await asUser(
      HOST,
      `select id from bookings where practitioner_id = auth.uid()`,
    );

    expect(asPractitioner.length).toBeGreaterThan(0);
    expect(hostAsPractitioner).toHaveLength(0);
  });

  /** The code is the practitioner's alone, whoever else can see the row. */
  it("withholds the access code from the host of the space", async () => {
    const [row] = await asUser<{ revealed_access_code: string | null }>(
      HOST,
      `select revealed_access_code from bookings_with_access_code where space_id = '${SPACE}'`,
    );
    expect(row.revealed_access_code).toBeNull();
  });
});

/**
 * Acceptance is a fact about a past moment, and the only thing that makes it
 * worth anything is that it is true.
 */
describe("accepting the terms", () => {
  /**
   * Written the way the app writes it.
   *
   * These tests passed against a plain UPDATE while the screen was silently
   * failing, because the client upserts — and Postgres checks the proposed
   * tuple before resolving the conflict, so a trigger that only fired on
   * UPDATE never ran and the version arrived with no timestamp beside it.
   * Testing a statement the app never issues proves the database works and
   * says nothing about the app.
   */
  it("records an acceptance sent as an upsert, the way the app sends it", async () => {
    await asUser(
      PRACTITIONER,
      `insert into profiles (id, terms_version) values (auth.uid(), 1)
         on conflict (id) do update set terms_version = excluded.terms_version`,
    );

    const [row] = await asUser<{ terms_version: number; terms_accepted_at: string | null }>(
      PRACTITIONER,
      `select terms_version, terms_accepted_at from profiles where id = auth.uid()`,
    );
    expect(row.terms_version).toBe(1);
    expect(row.terms_accepted_at).not.toBeNull();
  });

  it("records the version the account agreed to", async () => {
    await asUser(PRACTITIONER, `update profiles set terms_version = 1 where id = auth.uid()`);

    const [row] = await asUser<{ terms_version: number; terms_accepted_at: string | null }>(
      PRACTITIONER,
      `select terms_version, terms_accepted_at from profiles where id = auth.uid()`,
    );
    expect(row.terms_version).toBe(1);
    expect(row.terms_accepted_at).not.toBeNull();
  });

  /**
   * A client that could set the timestamp could say somebody agreed last year.
   * The trigger takes the server's clock whatever was sent.
   */
  it("ignores a backdated timestamp from the client", async () => {
    await asUser(
      PRACTITIONER,
      `update profiles set terms_version = 2, terms_accepted_at = '2020-01-01'
         where id = auth.uid()`,
    );

    const [row] = await asUser<{ terms_accepted_at: string }>(
      PRACTITIONER,
      `select terms_accepted_at from profiles where id = auth.uid()`,
    );
    expect(new Date(row.terms_accepted_at).getFullYear()).toBeGreaterThan(2024);
  });

  it("refuses to un-accept", async () => {
    await expect(
      asUser(
        PRACTITIONER,
        `update profiles set terms_version = null, terms_accepted_at = null where id = auth.uid()`,
      ),
    ).rejects.toThrow(/cannot be withdrawn/i);
  });

  /** Otherwise a change somebody was already shown could be rolled back. */
  it("refuses to go back to an older version", async () => {
    await expect(
      asUser(PRACTITIONER, `update profiles set terms_version = 1 where id = auth.uid()`),
    ).rejects.toThrow(/backwards/i);
  });

  it("stops anyone recording an acceptance on somebody else's behalf", async () => {
    await asUser(STRANGER, `update profiles set terms_version = 5 where id = '${HOST}'`);

    const [row] = await asUser<{ terms_version: number | null }>(
      HOST,
      `select terms_version from profiles where id = auth.uid()`,
    );
    expect(row.terms_version).toBeNull();
  });
});

/**
 * Which part of town, without which door.
 *
 * The trimming happens in the view, not the client. A column the browser has
 * to be trusted to cut down is a column the browser has already been sent.
 */
describe("the public area", () => {
  // Its own listing: earlier tests in this file deliberately push SPACE back
  // to pending, and a pending listing is not in the public view at all.
  const AREA_SPACE = "66666666-6666-6666-6666-666666666666";

  beforeAll(async () => {
    await db.exec(`
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${AREA_SPACE}', '${HOST}', 'Corner Room', 'physical', 5000, 2, 'keypad',
        'Second door', '1840 Gateway Dr, San Mateo, CA 94404, USA', 'active',
        'space/a/lease.pdf', now(), 'verified', now()
      );
    `);
  });

  it("drops the street and keeps the town", async () => {
    const [row] = await asUser<{ area: string }>(
      PRACTITIONER,
      `select area from spaces_public where id = '${AREA_SPACE}'`,
    );
    expect(row.area).toBe("San Mateo, CA 94404, USA");
  });

  it("never carries the street number", async () => {
    const [row] = await asUser<{ area: string }>(
      PRACTITIONER,
      `select area from spaces_public where id = '${AREA_SPACE}'`,
    );
    expect(row.area).not.toContain("1840");
    expect(row.area).not.toContain("Gateway");
  });

  /**
   * A one-part address cannot be split into street and town, and guessing
   * wrong leaks the thing this exists to withhold.
   */
  it("shows nothing rather than guessing", async () => {
    const [row] = await db.query<{ area: string | null }>(
      `select public_area('Just one line') as area`,
    ).then((r) => r.rows);
    expect(row.area).toBeNull();
  });

  it("still refuses the full address to anyone who has not booked", async () => {
    const found = await asUser(STRANGER, `select id from spaces where id = '${SPACE}'`);
    expect(found).toHaveLength(0);
  });
});

/**
 * The map draws roughly where the room is, not exactly.
 *
 * spaces_public publishes a point offset a few hundred metres (approx_lat /
 * approx_lng), so a real map can be drawn without naming a room we would not
 * name. The exact point never leaves the base table before a booking.
 */
describe("the map point", () => {
  // Its own listing, because earlier tests push SPACE back to pending and a
  // pending listing is not in the public view at all.
  const MAP_SPACE = "88888888-8888-8888-8888-888888888888";
  const LAT = 37.5485;
  const LNG = -122.3122;

  beforeAll(async () => {
    await db.exec(`
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, lat, lng, status, sublease_doc_path,
        legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${MAP_SPACE}', '${HOST}', 'Bay Room', 'physical', 5200, 4, 'keypad',
        'Ring the bell', '2 Bay Street', ${LAT}, ${LNG}, 'active',
        'space/m/lease.pdf', now(), 'verified', now()
      );
    `);
  });

  it("is a point near the studio, not its own position", async () => {
    const [shown] = await asUser<{ approx_lat: number; approx_lng: number }>(
      STRANGER,
      `select approx_lat, approx_lng from spaces_public where id = '${MAP_SPACE}'`,
    );

    // Offset off the building (250-450m), but still the same neighbourhood.
    expect(Number(shown.approx_lat) !== LAT || Number(shown.approx_lng) !== LNG).toBe(true);
    expect(Math.abs(Number(shown.approx_lat) - LAT)).toBeLessThan(0.01);
    expect(Math.abs(Number(shown.approx_lng) - LNG)).toBeLessThan(0.01);
  });

  it("carries the approximate point, not the street", async () => {
    const [shown] = await asUser<{ address_line: string | null; approx_lat: number | null }>(
      STRANGER,
      `select address_line, approx_lat from spaces_public where id = '${MAP_SPACE}'`,
    );

    // The offset point is published; the street is a NULL shim (migration 0055).
    expect(shown.approx_lat).not.toBeNull();
    expect(shown.address_line).toBeNull();
  });
});

/**
 * What we sent you, and nothing about how we sent it.
 *
 * The app has been emailing since the first booking and keeping no record
 * anybody could read: a host who missed the message about a session starting
 * in an hour had nowhere in the product to look. The row existed the whole
 * time and only staff could see it.
 */
describe("notification history", () => {
  beforeAll(async () => {
    await db.exec(`
      insert into notifications (user_id, kind, channel, dedupe_key, sent_at)
      values ('${PRACTITIONER}', 'booking_confirmed', 'email', 'k1', now());

      insert into notifications (user_id, kind, channel, dedupe_key, dropped_at, last_error, attempts)
      values ('${PRACTITIONER}', 'access_code_ready', 'email', 'k2', now(), 'mailbox full', 5);

      insert into notifications (user_id, kind, channel, dedupe_key)
      values ('${HOST}', 'host_new_booking', 'email', 'k3');
    `);
  });

  it("shows somebody their own messages", async () => {
    const mine = await asUser(PRACTITIONER, `select kind from my_notifications`);
    expect(mine).toHaveLength(2);
  });

  it("shows nobody else's", async () => {
    const theirs = await asUser<{ kind: string }>(HOST, `select kind from my_notifications`);
    expect(theirs.map((r) => r.kind)).toEqual(["host_new_booking"]);
  });

  /** The answer somebody is looking for when they are stood outside a door. */
  it("says which ones failed", async () => {
    const rows = await asUser<{ kind: string; state: string }>(
      PRACTITIONER,
      `select kind, state from my_notifications order by kind`,
    );

    expect(rows.find((r) => r.kind === "access_code_ready")?.state).toBe("failed");
    expect(rows.find((r) => r.kind === "booking_confirmed")?.state).toBe("sent");
  });

  it("calls one that has not been tried yet queued", async () => {
    const [row] = await asUser<{ state: string }>(HOST, `select state from my_notifications`);
    expect(row.state).toBe("queued");
  });

  /**
   * The grant is the boundary, not the view.
   *
   * A blanket select on the table would have made the view decorative: the
   * policy lets somebody read their own rows, so they could query the table
   * directly and get everything the view was written to hold back.
   */
  it.each(["last_error", "attempts", "dedupe_key"])(
    "refuses %s even on your own row",
    async (column) => {
      await expect(
        asUser(PRACTITIONER, `select ${column} from notifications`),
      ).rejects.toThrow(/permission denied/i);
    },
  );

  it("refuses somebody else's notification rows outright", async () => {
    const found = await asUser(
      HOST,
      `select id from notifications where user_id = '${PRACTITIONER}'`,
    );
    expect(found).toEqual([]);
  });

  it("does not let anybody write their own history", async () => {
    await expect(
      asUser(
        PRACTITIONER,
        `insert into notifications (user_id, kind, channel, dedupe_key)
         values (auth.uid(), 'booking_confirmed', 'email', 'forged')`,
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});

/**
 * The address arrives when the booking becomes committed.
 *
 * It used to arrive the moment a booking existed, which left a hole with no
 * cost: book, read the address, cancel more than 24 hours out, pay nothing,
 * and keep the address. Repeat for every listing on the board.
 */
describe("when the address is released", () => {
  const FAR_SPACE = "77777777-7777-7777-7777-777777777777";

  beforeAll(async () => {
    await db.exec(`
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${FAR_SPACE}', '${HOST}', 'Far Room', 'physical', 4000, 2, 'keypad',
        'Side door', '99 Far Lane', 'active', 'space/x/lease.pdf', now(),
        'verified', now()
      );

      insert into bookings (
        space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents, access_code, captured_at
      ) values (
        '${FAR_SPACE}', '${PRACTITIONER}',
        now() + interval '5 days', now() + interval '5 days 1 hour',
        -- captured_at is what separates a booking from a held hour, and this
        -- fixture is testing what a paying practitioner may see.
        false, false, 4000, 800, 0, 0, 0, 4800, 800, '9911', now()
      );
    `);
  });

  /** Five days out: still free to cancel, so still nothing to collect. */
  it("withholds it while the booking is free to cancel", async () => {
    const found = await asUser(
      PRACTITIONER,
      `select address_line from space_access_details('${FAR_SPACE}')`,
    );
    expect(found).toHaveLength(0);
  });

  it("releases it once inside the 24-hour window", async () => {
    await db.exec(
      `update bookings set starts_at = now() + interval '3 hours',
              ends_at = now() + interval '4 hours'
       where space_id = '${FAR_SPACE}'`,
    );

    const [details] = await asUser<{ address_line: string; entry_instructions: string }>(
      PRACTITIONER,
      `select address_line, entry_instructions from space_access_details('${FAR_SPACE}')`,
    );
    expect(details.address_line).toBe("99 Far Lane");
    expect(details.entry_instructions).toBe("Side door");
  });

  /** Somebody has to be able to find the place again afterwards. */
  it("keeps it after the session has happened", async () => {
    await db.exec(
      `update bookings set starts_at = now() - interval '3 days',
              ends_at = now() - interval '3 days' + interval '1 hour',
              status = 'completed'
       where space_id = '${FAR_SPACE}'`,
    );

    const found = await asUser(
      PRACTITIONER,
      `select address_line from space_access_details('${FAR_SPACE}')`,
    );
    expect(found).toHaveLength(1);
  });

  it("still refuses somebody with no booking at all", async () => {
    const found = await asUser(
      STRANGER,
      `select address_line from space_access_details('${FAR_SPACE}')`,
    );
    expect(found).toHaveLength(0);
  });
});

/**
 * Two studios on the platform at once.
 *
 * Everything above tests one owner against a practitioner or against a
 * stranger who holds nothing. This is the case the product is about to become:
 * a second host, with their own live room and their own money, reaching every
 * host surface legitimately. A leak here would not come from a missing policy
 * — it would come from a function that scoped by "is a host" rather than by
 * "is this host".
 */
describe("two studios on the same platform", () => {
  beforeAll(async () => {
    await db.exec(`
      insert into bookings (
        space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents, access_code, captured_at
      ) values (
        '${RIVAL_SPACE}', '${PRACTITIONER}',
        now() + interval '3 days', now() + interval '3 days 1 hour',
        false, false, 5200, 1040, 0, 0, 0, 6240, 1040, '7777', now()
      );
    `);
  });

  /*
   * Asserted as isolation rather than by name. Earlier blocks rename and
   * re-review the first studio as part of what they test, so anything keyed to
   * "Willow" here passes or fails on test order rather than on the policy.
   */
  it("shows each host only the sessions in their own rooms", async () => {
    const mine = await asUser<{ space_id: string }>(HOST, `select space_id from host_bookings()`);
    const theirs = await asUser<{ space_id: string }>(
      RIVAL_HOST,
      `select space_id from host_bookings()`,
    );

    expect(theirs).toHaveLength(1);
    expect(theirs[0].space_id).toBe(RIVAL_SPACE);
    expect(mine.some((b) => b.space_id === RIVAL_SPACE)).toBe(false);
  });

  /** What a rival charges is theirs; what they earned is nobody else's. */
  it("keeps one host's money out of the other's reach", async () => {
    const rows = await asUser<{ host_rate_cents: number }>(
      RIVAL_HOST,
      `select host_rate_cents from bookings`,
    );

    expect(rows.every((r) => r.host_rate_cents === 5200)).toBe(true);
  });

  it("refuses to let a host edit somebody else's listing", async () => {
    await asUser(
      RIVAL_HOST,
      `update spaces set hourly_rate_cents = 100 where id = '${SPACE}'`,
    );

    const [space] = await asUser<{ hourly_rate_cents: number }>(
      HOST,
      `select hourly_rate_cents from spaces where id = '${SPACE}'`,
    );

    // Not an error — the policy makes the row invisible, so the update matches
    // nothing. The rate is what matters, and it did not move.
    expect(space.hourly_rate_cents).not.toBe(100);
  });

  it("refuses to let a host take somebody else's listing down", async () => {
    await asUser(RIVAL_HOST, `delete from spaces where id = '${SPACE}'`);

    const [still] = await asUser(HOST, `select id from spaces where id = '${SPACE}'`);
    expect(still).toBeDefined();
  });

  /**
   * The rival owns a room the practitioner has booked, which is exactly the
   * position from which a nosy host would try to read the other booking.
   */
  it("keeps a rival host out of the entry instructions of a room they do not own", async () => {
    const found = await asUser(
      RIVAL_HOST,
      `select entry_instructions from space_access_details('${SPACE}')`,
    );

    expect(found).toEqual([]);
  });

  it("never hands a rival host an access code", async () => {
    const rows = await asUser<{ revealed_access_code: string | null }>(
      RIVAL_HOST,
      `select revealed_access_code from bookings_with_access_code`,
    );

    expect(rows.every((r) => r.revealed_access_code === null)).toBe(true);
  });

  it("keeps messages inside the booking they belong to", async () => {
    const rows = await asUser(RIVAL_HOST, `select id from messages`);
    expect(rows).toEqual([]);
  });

  /**
   * A live room is public whoever owns it, which is the one thing two studios
   * should share. Only the rival's is named: the first studio is deliberately
   * pushed back to pending by the editing tests above, which is itself correct
   * behaviour and would make an assertion about it a test of test order.
   */
  it("shows a second host's live room to somebody browsing", async () => {
    const rooms = await asUser<{ name: string }>(
      STRANGER,
      `select name from spaces_public order by name`,
    );
    expect(rooms.map((r) => r.name)).toContain("Cedar Room");
  });
});

/**
 * Why a listing is waiting, recorded where it starts waiting.
 *
 * 0019 already knew — `moved` is four comparisons — and threw it away, so the
 * queue showed a card with a name and an address and no way to tell what the
 * operator was being asked to look at. A studio that moved across town needs
 * its new address checked against a lease; one that changed its room type does
 * not.
 */
describe("what sent a listing back for review", () => {
  const reasonFor = async (id: string) =>
    (
      await asUser<{ review_reason: string | null; previous_address_line: string | null }>(
        HOST,
        `select review_reason, previous_address_line from spaces where id = '${id}'`,
      )
    )[0];

  beforeEach(async () => {
    await db.exec(
      `update spaces set status = 'active', sublease_doc_state = 'verified',
         sublease_doc_reviewed_at = now(), review_reason = null,
         previous_address_line = null, address_line = '9 Hidden Way'
       where id = '${PENDING_SPACE}'`,
    );
  });

  it("names the address, and keeps where it was", async () => {
    await asUser(
      HOST,
      `update spaces set address_line = '31 Moved Street' where id = '${PENDING_SPACE}'`,
    );

    const row = await reasonFor(PENDING_SPACE);
    expect(row.review_reason).toBe("address");
    expect(row.previous_address_line).toBe("9 Hidden Way");
  });

  /** Dragging the pin moves the room. "lat changed" is a number, not a place. */
  it("calls a moved pin an address change", async () => {
    await asUser(HOST, `update spaces set lat = 37.5, lng = -122.3 where id = '${PENDING_SPACE}'`);

    expect((await reasonFor(PENDING_SPACE)).review_reason).toBe("address");
  });

  it("names the room type, and leaves the address history alone", async () => {
    // Not 'spirit': that is what this fixture already is, and setting a column
    // to what it holds is not a change — the first version of this test set it
    // and then asserted the trigger had noticed.
    await asUser(HOST, `update spaces set category = 'physical' where id = '${PENDING_SPACE}'`);

    const row = await reasonFor(PENDING_SPACE);
    expect(row.review_reason).toBe("room type");
    // Overwriting this on a room-type edit would leave the operator comparing
    // an address against itself.
    expect(row.previous_address_line).toBeNull();
  });

  it("lists both when both moved", async () => {
    await asUser(
      HOST,
      `update spaces set address_line = '7 Both Road', category = 'traditional'
         where id = '${PENDING_SPACE}'`,
    );

    expect((await reasonFor(PENDING_SPACE)).review_reason).toBe("address, room type");
  });

  it("names a replaced sublease document", async () => {
    await asUser(
      HOST,
      `update spaces set sublease_doc_path = 'space/y/new.pdf' where id = '${PENDING_SPACE}'`,
    );

    expect((await reasonFor(PENDING_SPACE)).review_reason).toBe("sublease document");
  });

  /**
   * The note belongs to the review it was raised for. A listing live for a
   * month should not still carry the reason from the last time it moved.
   */
  it("clears the note when the listing goes live again", async () => {
    await asUser(
      HOST,
      `update spaces set address_line = '2 Cleared Lane' where id = '${PENDING_SPACE}'`,
    );
    expect((await reasonFor(PENDING_SPACE)).review_reason).toBe("address");

    // Staff approving, as the service role — which the trigger does not run for.
    await db.exec(
      `update spaces set status = 'active', sublease_doc_state = 'verified',
         sublease_doc_reviewed_at = now(), review_reason = null,
         previous_address_line = null
       where id = '${PENDING_SPACE}'`,
    );

    const row = await reasonFor(PENDING_SPACE);
    expect(row.review_reason).toBeNull();
    expect(row.previous_address_line).toBeNull();
  });

  /** A host who could set this could describe a move as a typo. */
  it("does not let a host write the reason themselves", async () => {
    await expect(
      asUser(HOST, `update spaces set review_reason = 'nothing' where id = '${PENDING_SPACE}'`),
    ).rejects.toThrow(/permission denied/i);
  });
});

/**
 * What people searched for, which nobody may read.
 *
 * This table is the one place on the site holding "who is looking for what,
 * where, and here is their email". It is useful to us and would be a gift to
 * anybody else, so the whole design is: anyone may write a row, nobody may
 * read one. There is no select policy at all — not a narrow one, not one
 * scoped to the author, none — and these tests exist because a policy added
 * later in good faith would be invisible in review and would open the list.
 */
describe("what people searched for stays private", () => {
  it("lets a stranger say what they were looking for", async () => {
    await expect(
      asAnon(`
        insert into space_requests (space_type, looking_in, email)
        values ('massage-room', 'San Mateo', 'somebody@example.com')
      `),
    ).resolves.toBeDefined();
  });

  it("lets them say it without leaving an address", async () => {
    await expect(
      asAnon(`insert into space_requests (space_type, looking_in) values (null, 'Belmont')`),
    ).resolves.toBeDefined();
  });

  /*
   * The whole point, and it refuses harder than expected.
   *
   * A table with row-level security and no matching policy returns no rows,
   * which would have been enough. This does not even get that far: there is no
   * SELECT grant, so the query is refused outright. Asserted as a rejection
   * rather than as an empty result, because those are different guarantees and
   * the stronger one is the one that is actually true — an empty array would
   * also be what a policy that quietly stopped matching returns.
   */
  it("does not let a stranger read a single row", async () => {
    await expect(asAnon(`select * from space_requests`)).rejects.toThrow(/permission denied/i);
  });

  /*
   * And neither can somebody with an account. There is no version of this
   * where a signed-in host gets to page through who has been looking.
   */
  it("does not let a signed-in account read them either", async () => {
    await expect(asUser(HOST, `select * from space_requests`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("never exposes an address through the counts", async () => {
    const columns = await asAnon(`select * from space_demand limit 1`);
    const names = columns.length > 0 ? Object.keys(columns[0]) : [];
    expect(names).not.toContain("email");
    expect(names).not.toContain("id");
  });

  /*
   * Three, the same floor the city pages use. One search is not demand — it is
   * one person, and quoting it to a host both overstates the case and
   * describes an individual more precisely than a count should.
   */
  it("says nothing until enough people have asked", async () => {
    const quiet = await asAnon(
      `select * from space_demand where looking_in = 'San Mateo'`,
    );
    expect(quiet).toEqual([]);

    for (let i = 0; i < 2; i++) {
      await asAnon(
        `insert into space_requests (space_type, looking_in) values ('massage-room', 'San Mateo')`,
      );
    }

    const [loud] = await asAnon<{ request_count: number }>(
      `select request_count from space_demand where looking_in = 'San Mateo'`,
    );
    expect(loud.request_count).toBe(3);
  });

  it("refuses a use that is not one of ours", async () => {
    await expect(
      asAnon(`insert into space_requests (space_type, looking_in) values ('therapy-office', 'Belmont')`),
    ).rejects.toThrow();
  });

  it("refuses an essay in place of a town", async () => {
    await expect(
      asAnon(`insert into space_requests (looking_in) values (repeat('x', 200))`),
    ).rejects.toThrow();
  });
});

/**
 * Every column `editSpace` writes, and whether a host may actually write it.
 *
 * 0019 revoked blanket update on `spaces` and granted it column by column.
 * That is the right shape and it has one failure mode: a later migration adds
 * a host-writable column and forgets the grant. It happened twice — 0043 added
 * four and 0045 added one, and neither granted anything.
 *
 * The damage is not limited to the new fields. Postgres checks the privilege
 * on every column in the SET list, and `editSpace` builds one statement, so a
 * single ungranted column refuses the whole edit: the rate, the name, the
 * photographs, the entry instructions. Entry instructions are the way into
 * somebody's building, and a host changes them when somebody should stop being
 * able to get in — so the revocation path was the thing that broke.
 *
 * The column list is read out of the repository rather than written here. A
 * list in a test is a list that goes stale the same way the grants did, and
 * this test exists precisely because somebody has to notice.
 */
describe("a host can edit every column the app writes", () => {
  const columnsEditSpaceWrites = (): string[] => {
    const source = readFileSync("src/lib/supabase-repository.ts", "utf8");
    const editSpace = source.slice(
      source.indexOf("async editSpace("),
      source.indexOf("async updateSpaceAvailability("),
    );
    return [...new Set([...editSpace.matchAll(/patch\.([a-z_]+) =/g)].map((m) => m[1]))].sort();
  };

  it("finds the columns to check", () => {
    // A regex that silently matched nothing would make every assertion below
    // pass while proving only that the parser is broken.
    expect(columnsEditSpaceWrites().length).toBeGreaterThan(15);
  });

  /**
   * The assertion is about privilege, not about whether the write is allowed.
   *
   * A host may be refused for good reasons — 0019 refuses to move a listing
   * that has sessions booked against it, and a not-null column refuses a null.
   * Those are the rules working. "permission denied" is the missing grant, and
   * it is the only failure this is looking for. Asserting success instead
   * would tie the test to every business rule the trigger enforces.
   */
  const deniedByPrivilege = async (sql: string): Promise<boolean> => {
    try {
      await asUser(HOST, sql);
      return false;
    } catch (error) {
      return /permission denied/i.test((error as Error).message);
    }
  };

  it.each(columnsEditSpaceWrites())("grants update on %s", async (column) => {
    expect(await deniedByPrivilege(`update spaces set ${column} = ${column} where id = '${SPACE}'`)).toBe(
      false,
    );
  });

  /*
   * And every column at once, which is the statement the app actually sends:
   * `editSpace` builds one patch and issues one update, so a single ungranted
   * column refuses the whole edit — the rate, the name, the photographs, and
   * the entry instructions a host is changing because somebody should no
   * longer be able to get in.
   */
  it("accepts the whole patch, as editSpace sends it", async () => {
    const assignments = columnsEditSpaceWrites()
      .map((column) => `${column} = ${column}`)
      .join(", ");

    expect(await deniedByPrivilege(`update spaces set ${assignments} where id = '${SPACE}'`)).toBe(
      false,
    );
  });
});

/**
 * A space cannot be listed until its host has accepted the Host Terms — and
 * the version accepted is the database's to decide, not the caller's.
 *
 * The gate is in RLS (migration 0052), so a direct insert cannot skip it any
 * more than the client can. These run the insert as the host would, through
 * the `authenticated` role, which is the only way the policy is exercised at
 * all — the beforeAll seed writes as superuser and bypasses it.
 */
describe("listing requires accepting the Host Terms", () => {
  // Fresh accounts, so nothing the earlier blocks did leaks in. Each is a host
  // by account_type — the account gate is not what these tests are about — and
  // starts with no Host Terms acceptance.
  const NEW_HOST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const FORGER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const SEPARATE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  const listing = (id: string) => `
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${id}', auth.uid(), 'New Room', 'physical', 4000, 3, 'keypad',
      'Panel by the door', '1 New Street', 'pending',
      'space/n/lease.pdf', now(), 'pending', null
    )`;

  beforeAll(async () => {
    // profiles.id references auth.users(id), so the user has to exist first.
    // Written as superuser, which is how the real seed is written too.
    await db.exec(`
      insert into auth.users (id, email) values
        ('${NEW_HOST}', 'fresh@example.com'),
        ('${FORGER}', 'clever@example.com'),
        ('${SEPARATE}', 'two@example.com');

      insert into profiles (id, display_name, account_type) values
        ('${NEW_HOST}', 'Fresh Studio', 'host'),
        ('${FORGER}', 'Clever Studio', 'host'),
        ('${SEPARATE}', 'Two Studio', 'host');
    `);
  });

  /* CASE A: a host account with no Host Terms acceptance cannot publish. */
  it("refuses the insert when the Host Terms are not accepted", async () => {
    await expect(
      asUser(NEW_HOST, listing("d1111111-1111-4111-8111-111111111111")),
    ).rejects.toThrow(/row-level security/i);
  });

  /* CASE B: accepting the current version opens the gate. */
  it("allows the insert once the Host Terms are accepted", async () => {
    await asUser(
      NEW_HOST,
      `insert into profiles (id, host_terms_version) values (auth.uid(), 1)
         on conflict (id) do update set host_terms_version = 1`,
    );

    await expect(
      asUser(NEW_HOST, listing("d2222222-2222-4222-8222-222222222222")),
    ).resolves.toBeDefined();
  });

  /*
   * CASE H: a forged high version is clamped to what the database requires.
   * The caller cannot record a version they were not shown, so cannot vault
   * themselves past a future re-acceptance the gate will demand.
   */
  it("records the required version, whatever the client sent", async () => {
    await asUser(
      FORGER,
      `insert into profiles (id, host_terms_version) values (auth.uid(), 999)
         on conflict (id) do update set host_terms_version = 999`,
    );

    const [row] = await asUser<{ host_terms_version: number; host_terms_accepted_at: string | null }>(
      FORGER,
      `select host_terms_version, host_terms_accepted_at from profiles where id = auth.uid()`,
    );

    expect(row.host_terms_version).toBe(3);
    expect(row.host_terms_accepted_at).not.toBeNull();
  });

  /* Accepted terms cannot be withdrawn. */
  it("refuses to unset an accepted version", async () => {
    await asUser(
      NEW_HOST,
      `update profiles set host_terms_version = 3 where id = auth.uid()`,
    );
    await expect(
      asUser(NEW_HOST, `update profiles set host_terms_version = null where id = auth.uid()`),
    ).rejects.toThrow(/withdrawn/i);
  });

  /*
   * CASE F: the general-terms acceptance is a separate record. Setting one does
   * not set the other, so a host who accepted the app's terms still has to
   * accept the Host Terms before listing (and the reverse).
   */
  it("keeps Host Terms acceptance separate from general terms", async () => {
    await asUser(
      SEPARATE,
      `insert into profiles (id, terms_version) values (auth.uid(), 1)
         on conflict (id) do update set terms_version = 1`,
    );

    const [row] = await asUser<{ terms_version: number; host_terms_version: number | null }>(
      SEPARATE,
      `select terms_version, host_terms_version from profiles where id = auth.uid()`,
    );
    expect(row.terms_version).toBe(1);
    expect(row.host_terms_version).toBeNull();
  });
});

/**
 * Practitioner trust (migration 0057): identity is the server's to set, the
 * profession is a controlled value, and a host sees a coarse summary — never
 * another host's bookings or any document.
 */
describe("practitioner trust and identity", () => {
  // Isolated ids, so the counts here cannot be moved by the bookings other
  // blocks in this shared database create.
  const THOST = "00000057-0000-4000-8000-000000000001";
  const TPRAC = "00000057-0000-4000-8000-000000000002";
  const TOTHER = "00000057-0000-4000-8000-000000000003";
  const TSPACE = "00000057-0000-4000-8000-000000000010";

  beforeAll(async () => {
    // Written as the server would (a direct exec has no auth.uid()), which the
    // spoof test proves the client cannot do: verified identity, verified cover,
    // a chosen profession.
    await db.exec(`
      insert into auth.users (id, email) values
        ('${THOST}', 'thost@example.com'),
        ('${TPRAC}', 'tprac@example.com'),
        ('${TOTHER}', 'tother@example.com');

      insert into profiles (id, display_name) values
        ('${THOST}', 'Trust Host'),
        ('${TOTHER}', 'Other Host');

      insert into profiles (
        id, display_name, identity_verified_at, insurance_doc_path,
        insurance_doc_state, insurance_doc_reviewed_at,
        insurance_effective_date, insurance_expires_at, profession
      ) values (
        '${TPRAC}', 'Trust Prac', now(), 'prac/x/cert.pdf',
        'verified', now(), now() - interval '1 day', now() + interval '365 days', 'pilates'
      );

      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
        sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${TSPACE}', '${THOST}', 'Trust Room', 'physical', 4500, 3, 'keypad',
        'Panel by the door', '1 Trust Way', 'active',
        'space/t/lease.pdf', now(), 'verified', now()
      );

      -- A completed, paid session — the only kind that counts toward the number.
      insert into bookings (
        space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents,
        access_code, access_code_revealed_at, captured_at, status
      ) values (
        '${TSPACE}', '${TPRAC}',
        now() - interval '2 days', now() - interval '2 days' + interval '1 hour',
        false, false, 4500, 900, 0, 0, 0, 5400, 900,
        '1111', now() - interval '2 days', now() - interval '2 days', 'completed'
      );

      -- Cancelled well ahead of the session: paid, but neither a completed
      -- session nor a late cancellation, so it counts for nothing.
      insert into bookings (
        space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents,
        access_code, access_code_revealed_at, captured_at, status,
        cancelled_at, cancelled_by
      ) values (
        '${TSPACE}', '${TPRAC}',
        now() + interval '3 days', now() + interval '3 days' + interval '1 hour',
        false, false, 4500, 900, 0, 0, 0, 5400, 900,
        '2222', now() + interval '3 days', now() - interval '6 days',
        'cancelled_by_practitioner', now() - interval '6 days', 'practitioner'
      );

      -- An unpaid hold — never counts.
      insert into bookings (
        space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents,
        access_code, access_code_revealed_at, status
      ) values (
        '${TSPACE}', '${TPRAC}',
        now() + interval '4 days', now() + interval '4 days' + interval '1 hour',
        false, false, 4500, 900, 0, 0, 0, 5400, 900,
        '3333', now() + interval '4 days', 'upcoming'
      );

      -- A pending, card-authorized request — what host_requests() answers.
      insert into bookings (
        space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
        credit_applied_cents, total_cents, platform_cents,
        access_code, access_code_revealed_at, approval_state, authorized_at, status
      ) values (
        '${TSPACE}', '${TPRAC}',
        now() + interval '5 days', now() + interval '5 days' + interval '1 hour',
        false, false, 4500, 900, 0, 0, 0, 5400, 900,
        '4444', now() + interval '5 days', 'pending', now(), 'upcoming'
      );
    `);
  });

  it("refuses a practitioner marking their own identity verified", async () => {
    await expect(
      asUser(TPRAC, `update profiles set identity_verified_at = now() where id = '${TPRAC}'`),
    ).rejects.toThrow(/server/i);
  });

  it("refuses an unknown profession and accepts a known one", async () => {
    await expect(
      asUser(TPRAC, `update profiles set profession = 'astronaut' where id = '${TPRAC}'`),
    ).rejects.toThrow();
    await expect(
      asUser(TPRAC, `update profiles set profession = 'yoga' where id = '${TPRAC}'`),
    ).resolves.toBeDefined();
    // Back to the value the summary tests read.
    await db.exec(`update profiles set profession = 'pilates' where id = '${TPRAC}'`);
  });

  it("shows the host the practitioner's trust summary on a request", async () => {
    const rows = await asUser<{
      practitioner_profession: string | null;
      practitioner_identity_verified: boolean;
      practitioner_insurance_verified: boolean;
      practitioner_good_standing: boolean;
      practitioner_completed_sessions: number;
    }>(THOST, `select * from host_requests()`);

    expect(rows.length).toBe(1); // the one pending, authorized request
    const req = rows[0];
    expect(req.practitioner_profession).toBe("pilates");
    expect(req.practitioner_identity_verified).toBe(true);
    expect(req.practitioner_insurance_verified).toBe(true);
    expect(req.practitioner_good_standing).toBe(true);
    // Only the one completed, paid session — not the cancelled or unpaid rows.
    expect(Number(req.practitioner_completed_sessions)).toBe(1);
  });

  it("counts only completed, paid sessions in the host's history summary", async () => {
    const rows = await asUser<{ practitioner_completed_sessions: number }>(
      THOST,
      `select * from host_bookings()`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Number(row.practitioner_completed_sessions)).toBe(1);
    }
  });

  it("does not leak a practitioner's bookings to an unrelated host", async () => {
    const requests = await asUser(TOTHER, `select * from host_requests()`);
    const history = await asUser(TOTHER, `select * from host_bookings()`);
    expect(requests).toEqual([]);
    expect(history).toEqual([]);
  });

  it("refuses a practitioner marking their own credential verified", async () => {
    await expect(
      asUser(TPRAC, `update profiles set credential_doc_state = 'verified' where id = '${TPRAC}'`),
    ).rejects.toThrow(/staff/i);
  });

  it("returns a credential to pending review when a new document is submitted", async () => {
    // A submitted document, then staff verify it in a second write (no path
    // change, so the trigger does not reset it)…
    await db.exec(
      `update profiles set credential_doc_path = 'practitioner/${TPRAC}/cred-a.pdf' where id = '${TPRAC}'`,
    );
    await db.exec(
      `update profiles set credential_doc_state = 'verified', credential_doc_reviewed_at = now() where id = '${TPRAC}'`,
    );
    // …then the practitioner uploads a replacement, which restarts review.
    await asUser(
      TPRAC,
      `update profiles set credential_doc_path = 'practitioner/${TPRAC}/cred-b.pdf' where id = '${TPRAC}'`,
    );
    const [row] = await asUser<{
      credential_doc_state: string | null;
      credential_doc_reviewed_at: string | null;
    }>(TPRAC, `select credential_doc_state, credential_doc_reviewed_at from profiles where id = '${TPRAC}'`);
    expect(row.credential_doc_state).toBe("pending");
    expect(row.credential_doc_reviewed_at).toBeNull();
  });

  it("shows the host a reviewed credential as a boolean, never the document or note", async () => {
    // Path first (trigger resets to pending), then the verdict without a path
    // change — the only way a verified state survives, and how staff review works.
    await db.exec(
      `update profiles set credential_doc_path = 'practitioner/${TPRAC}/cred.pdf' where id = '${TPRAC}'`,
    );
    await db.exec(
      `update profiles set credential_doc_state = 'verified', credential_doc_reviewed_at = now() where id = '${TPRAC}'`,
    );
    const [req] = await asUser<Record<string, unknown>>(THOST, `select * from host_requests()`);
    expect(req.practitioner_credential_reviewed).toBe(true);
    expect(Object.keys(req)).not.toContain("credential_doc_path");
    expect(Object.keys(req)).not.toContain("credential_number");
    expect(Object.keys(req)).not.toContain("credential_review_note");
  });
});

/*
 * The verification verdicts — identity, insurance, credential — are the
 * server's alone, on INSERT as much as UPDATE. The profile row is created by the
 * client, so a crafted first INSERT is the vector these prove is closed: a fresh
 * account cannot arrive already verified, and cannot self-promote afterwards.
 * The service role (webhook, identity session route, admin review) still sets
 * every verdict, and the practitioner can still upload documents.
 */
describe("verification verdicts are the server's, on insert and update", () => {
  const FRESH = "00000058-0000-4000-8000-000000000001";

  beforeAll(async () => {
    await db.exec(`insert into auth.users (id, email) values ('${FRESH}', 'fresh58@example.com');`);
  });

  it("refuses a crafted first INSERT that self-verifies identity", async () => {
    await expect(
      asUser(FRESH, `insert into profiles (id, identity_verified_at) values (auth.uid(), now())`),
    ).rejects.toThrow(/server/i);
  });

  it("refuses a crafted first INSERT that self-verifies insurance", async () => {
    await expect(
      asUser(
        FRESH,
        `insert into profiles (id, insurance_doc_state, insurance_doc_reviewed_at) values (auth.uid(), 'verified', now())`,
      ),
    ).rejects.toThrow(/staff/i);
  });

  it("refuses a crafted first INSERT that self-reviews a credential", async () => {
    await expect(
      asUser(
        FRESH,
        `insert into profiles (id, credential_doc_state, credential_doc_reviewed_at) values (auth.uid(), 'verified', now())`,
      ),
    ).rejects.toThrow(/staff/i);
  });

  it("refuses the all-at-once crafted INSERT the audit flagged", async () => {
    await expect(
      asUser(
        FRESH,
        `insert into profiles (id, identity_verified_at, insurance_doc_state, insurance_doc_reviewed_at,
                               credential_doc_state, credential_doc_reviewed_at)
           values (auth.uid(), now(), 'verified', now(), 'verified', now())`,
      ),
    ).rejects.toThrow(/server|staff/i);
  });

  it("still allows a plain first profile INSERT, verified of nothing", async () => {
    await expect(
      asUser(FRESH, `insert into profiles (id, display_name, account_type) values (auth.uid(), 'Fresh', 'practitioner')`),
    ).resolves.toBeDefined();
    const [row] = await asUser<{
      identity_verified_at: string | null;
      insurance_doc_state: string;
      credential_doc_state: string | null;
    }>(
      FRESH,
      `select identity_verified_at, insurance_doc_state, credential_doc_state from profiles where id = auth.uid()`,
    );
    expect(row.identity_verified_at).toBeNull();
    expect(row.insurance_doc_state).toBe("pending");
    expect(row.credential_doc_state).toBeNull();
  });

  it("refuses self-promoting any verdict through UPDATE", async () => {
    await expect(
      asUser(FRESH, `update profiles set identity_verified_at = now() where id = auth.uid()`),
    ).rejects.toThrow(/server/i);
    await expect(
      asUser(
        FRESH,
        `update profiles set insurance_doc_state = 'verified', insurance_doc_reviewed_at = now() where id = auth.uid()`,
      ),
    ).rejects.toThrow(/staff/i);
    await expect(
      asUser(
        FRESH,
        `update profiles set credential_doc_state = 'verified', credential_doc_reviewed_at = now() where id = auth.uid()`,
      ),
    ).rejects.toThrow(/staff/i);
  });

  it("lets the practitioner upload insurance, which stays pending, then staff verify", async () => {
    await asUser(FRESH, `update profiles set insurance_doc_path = 'prac/${FRESH}/ins.pdf' where id = auth.uid()`);
    const [uploaded] = await asUser<{ insurance_doc_state: string; insurance_doc_reviewed_at: string | null }>(
      FRESH,
      `select insurance_doc_state, insurance_doc_reviewed_at from profiles where id = auth.uid()`,
    );
    expect(uploaded.insurance_doc_state).toBe("pending");
    expect(uploaded.insurance_doc_reviewed_at).toBeNull();

    // Staff (service role) verify it.
    await db.exec(
      `update profiles set insurance_doc_state = 'verified', insurance_doc_reviewed_at = now(),
         insurance_effective_date = now() - interval '1 day', insurance_expires_at = now() + interval '365 days'
       where id = '${FRESH}'`,
    );
    const [verified] = await asUser<{ insurance_doc_state: string }>(
      FRESH,
      `select insurance_doc_state from profiles where id = auth.uid()`,
    );
    expect(verified.insurance_doc_state).toBe("verified");
  });

  it("resets insurance to pending and clears the verdict when the certificate is replaced", async () => {
    await asUser(FRESH, `update profiles set insurance_doc_path = 'prac/${FRESH}/ins2.pdf' where id = auth.uid()`);
    const [row] = await asUser<{ insurance_doc_state: string; insurance_effective_date: string | null }>(
      FRESH,
      `select insurance_doc_state, insurance_effective_date from profiles where id = auth.uid()`,
    );
    expect(row.insurance_doc_state).toBe("pending");
    expect(row.insurance_effective_date).toBeNull();
  });

  it("lets the practitioner upload a credential, which stays pending, then staff review", async () => {
    await asUser(
      FRESH,
      `update profiles set credential_doc_path = 'prac/${FRESH}/cred.pdf', credential_type = 'RYT-200' where id = auth.uid()`,
    );
    const [pending] = await asUser<{ credential_doc_state: string | null }>(
      FRESH,
      `select credential_doc_state from profiles where id = auth.uid()`,
    );
    expect(pending.credential_doc_state).toBe("pending");

    await db.exec(
      `update profiles set credential_doc_state = 'verified', credential_doc_reviewed_at = now() where id = '${FRESH}'`,
    );
    const [reviewed] = await asUser<{ credential_doc_state: string | null }>(
      FRESH,
      `select credential_doc_state from profiles where id = auth.uid()`,
    );
    expect(reviewed.credential_doc_state).toBe("verified");
  });

  it("lets the Stripe Identity server flow verify identity (service role)", async () => {
    await db.exec(
      `update profiles set identity_verified_at = now(), identity_session_id = 'vs_test_123' where id = '${FRESH}'`,
    );
    const [row] = await asUser<{ identity_verified_at: string | null }>(
      FRESH,
      `select identity_verified_at from profiles where id = auth.uid()`,
    );
    expect(row.identity_verified_at).not.toBeNull();
  });
});
