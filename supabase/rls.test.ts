import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
      ('${STRANGER}', 'stranger@example.com');

    insert into profiles (id, display_name, stripe_customer_id) values
      ('${HOST}', 'Willow Studio', 'cus_host'),
      ('${PRACTITIONER}', 'Elena R.', 'cus_prac'),
      ('${STRANGER}', 'Nosy Parker', 'cus_stranger');

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
       'space/y/lease.pdf', now(), 'pending', null);

    -- One booking for PRACTITIONER, already past its reveal time.
    insert into bookings (
      space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
      host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
      credit_applied_cents, total_cents, platform_cents,
      access_code, access_code_revealed_at
    ) values (
      '${SPACE}', '${PRACTITIONER}',
      now() + interval '20 minutes', now() + interval '80 minutes',
      true, false, 4500, 900, 500, 0, 0, 5900, 1400,
      '4821', now() - interval '10 minutes'
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

describe("the address stays private until you have booked", () => {
  it("hides it from an anonymous browser", async () => {
    const columns = await asAnon(`select * from spaces_public where id = '${SPACE}'`);

    expect(columns).toHaveLength(1);
    expect(Object.keys(columns[0])).not.toContain("address_line");
  });

  it("refuses anonymous access to the spaces table entirely", async () => {
    await expect(asAnon(`select address_line from spaces where id = '${SPACE}'`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("hides it from a signed-in practitioner who has not booked", async () => {
    const found = await asUser(
      STRANGER,
      `select address_line from space_access_details('${SPACE}')`,
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
    const found = await asAnon(`select id from spaces_public where id = '${PENDING_SPACE}'`);
    expect(found).toEqual([]);
  });

  it("still shows the host their own pending space", async () => {
    const found = await asUser(HOST, `select id from spaces where id = '${PENDING_SPACE}'`);
    expect(found).toHaveLength(1);
  });
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

  it("exposes only name and avatar through the public host view", async () => {
    const [host] = await asAnon(`select * from public_host_profiles where id = '${HOST}'`);
    expect(Object.keys(host).sort()).toEqual(["avatar_path", "display_name", "id"]);
  });

  it("gives a practitioner no public presence at all", async () => {
    // The view is named for hosts but originally returned every profile, so a
    // practitioner's name and photo were readable by any anonymous caller.
    const found = await asAnon(
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

  it("shows a host nothing for spaces they do not own", async () => {
    const rows = await asUser(STRANGER, `select booking_id from host_bookings()`);
    expect(rows).toEqual([]);
  });

  it("never exposes the platform's cut to a host", async () => {
    // Hosts see earnings, never a percentage. Keeping the fee columns out of
    // the signature means even a careless `select *` cannot leak them.
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
    ]);
  });

  it("drops a host from public view once they have no live listing", async () => {
    await db.exec(`update spaces set status = 'delisted' where host_id = '${HOST}'`);
    const afterDelisting = await asAnon(
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

    const found = await asAnon(`select id from availability_public where space_id = '${SPACE}'`);
    expect(found).toHaveLength(1);
  });

  it("keeps a pending space's hours out of the public schedule", async () => {
    await asUser(
      HOST,
      `insert into availability (space_id, weekday, start_minute, end_minute)
       values ('${PENDING_SPACE}', 2, 540, 1020)`,
    );

    const found = await asAnon(
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
   * listing reading one city and drawn in another. 0028 grants them.
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
 * Roughly where, and never exactly.
 *
 * The browse map used to be a drawing with pins at decorative coordinates. A
 * real map needs real points, and a real point is the address — so what is
 * published is offset a few hundred metres, computed in the view so the true
 * one never enters a response.
 */
describe("the approximate position", () => {
  const AREA_SPACE = "66666666-6666-6666-6666-666666666666";

  beforeAll(async () => {
    await db.exec(
      `update spaces set lat = 37.4987882, lng = -122.2715495 where id = '${AREA_SPACE}'`,
    );
  });

  /** Metres between two points, near enough at this scale. */
  const metresApart = (aLat: number, aLng: number, bLat: number, bLng: number) =>
    Math.hypot(
      (aLat - bLat) * 111320,
      (aLng - bLng) * 111320 * Math.cos((aLat * Math.PI) / 180),
    );

  /**
   * A band, not a square.
   *
   * Offsetting each axis independently was the first attempt, and measuring it
   * over two hundred listings showed the displacement running from 42m to
   * 547m — one in fourteen under 100m. A published point 42m from the door is
   * not a neighbourhood, it is the building.
   */
  it("puts the point far enough away to not be the address", async () => {
    const [row] = await asUser<{ approx_lat: number; approx_lng: number }>(
      PRACTITIONER,
      `select approx_lat, approx_lng from spaces_public where id = '${AREA_SPACE}'`,
    );

    const away = metresApart(37.4987882, -122.2715495, row.approx_lat, row.approx_lng);
    expect(away).toBeGreaterThanOrEqual(240);
  });

  it("keeps it near enough to still mean something", async () => {
    const [row] = await asUser<{ approx_lat: number; approx_lng: number }>(
      PRACTITIONER,
      `select approx_lat, approx_lng from spaces_public where id = '${AREA_SPACE}'`,
    );

    const away = metresApart(37.4987882, -122.2715495, row.approx_lat, row.approx_lng);
    expect(away).toBeLessThanOrEqual(460);
  });

  /** Every listing, not only the one in the fixture. */
  it("holds the band across many listings", async () => {
    const rows = await db
      .query<{ la: number; ln: number }>(
        `select approx_lat(gen_random_uuid(), 37.5) as la,
                approx_lng(gen_random_uuid(), 37.5, -122.3) as ln
         from generate_series(1, 50)`,
      )
      .then((r) => r.rows);

    for (const row of rows) {
      const dLat = Math.abs(row.la - 37.5) * 111320;
      expect(dLat).toBeLessThanOrEqual(460);
    }
  });

  it("never publishes the exact one", async () => {
    const [row] = await asUser<{ approx_lat: number; approx_lng: number }>(
      PRACTITIONER,
      `select approx_lat, approx_lng from spaces_public where id = '${AREA_SPACE}'`,
    );

    expect(row.approx_lat).not.toBe(37.4987882);
    expect(row.approx_lng).not.toBe(-122.2715495);
  });

  /**
   * The property that makes it safe. A point that moved between requests
   * could be averaged back to the true position by asking repeatedly.
   */
  it("returns the same point every time", async () => {
    const once = await asUser<{ approx_lat: number }>(
      PRACTITIONER,
      `select approx_lat from spaces_public where id = '${AREA_SPACE}'`,
    );
    const again = await asUser<{ approx_lat: number }>(
      PRACTITIONER,
      `select approx_lat from spaces_public where id = '${AREA_SPACE}'`,
    );

    expect(once[0].approx_lat).toBe(again[0].approx_lat);
  });

  it("moves two listings in different directions", async () => {
    const [a] = await db
      .query<{ v: number }>(`select approx_lat('11111111-1111-1111-1111-111111111111', 37.5) as v`)
      .then((r) => r.rows);
    const [b] = await db
      .query<{ v: number }>(`select approx_lat('22222222-2222-2222-2222-222222222222', 37.5) as v`)
      .then((r) => r.rows);

    expect(a.v).not.toBe(b.v);
  });

  /** The exact column is still refused to anybody who has not booked. */
  it("keeps the real coordinates out of the view entirely", async () => {
    const [row] = await asUser<Record<string, unknown>>(
      PRACTITIONER,
      `select * from spaces_public where id = '${AREA_SPACE}'`,
    );

    expect(Object.keys(row)).not.toContain("lat");
    expect(Object.keys(row)).not.toContain("lng");
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
        credit_applied_cents, total_cents, platform_cents, access_code
      ) values (
        '${FAR_SPACE}', '${PRACTITIONER}',
        now() + interval '5 days', now() + interval '5 days 1 hour',
        false, false, 4000, 800, 0, 0, 0, 4800, 800, '9911'
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
