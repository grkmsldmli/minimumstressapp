import { readFileSync } from "node:fs";
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
  for (const file of [
    "0000_supabase_stubs.sql",
    "0001_schema.sql",
    "0002_rls.sql",
    "0003_storage.sql",
    "0004_narrow_public_profiles.sql",
    "0005_host_bookings.sql",
    "0006_service_role_grants.sql",
    "0007_space_details.sql",
  ]) {
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

    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at
    ) values
      ('${SPACE}', '${HOST}', 'Willow', 'physical', 4500, 3, 'keypad',
       'Panel to the left of the blue door', '12 Alder Lane', 'active',
       'space/x/lease.pdf', now()),
      ('${PENDING_SPACE}', '${HOST}', 'Not Yet Live', 'spirit', 2600, 6, 'lockbox',
       'Lockbox under the bench', '9 Hidden Way', 'pending',
       'space/y/lease.pdf', now());

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
