import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "migrations");
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== "0000_supabase_stubs.sql")
  .sort();

let db: PGlite;
const host = "10000000-0000-4000-8000-000000000011";
const otherHost = "10000000-0000-4000-8000-000000000012";
const admin = "10000000-0000-4000-8000-000000000013";
const requestedSpace = "20000000-0000-4000-8000-000000000011";
const rollbackSpace = "20000000-0000-4000-8000-000000000012";
const otherSpace = "20000000-0000-4000-8000-000000000013";
const incompleteSpace = "20000000-0000-4000-8000-000000000014";
const completePendingSpace = "20000000-0000-4000-8000-000000000015";

async function asRole(role: "authenticated" | "service_role", id: string, sql: string) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false); set role ${role};`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("0000_supabase_stubs.sql"));
  for (const migration of migrations) await db.exec(read(migration));

  await db.exec(`
    insert into auth.users (id, email) values
      ('${host}', 'closure-host@example.com'),
      ('${otherHost}', 'other-host@example.com'),
      ('${admin}', 'admin@example.com');
    insert into profiles (id, display_name, account_type) values
      ('${host}', 'Closure Host', 'host'),
      ('${otherHost}', 'Other Host', 'host'),
      ('${admin}', 'Admin', 'host');
    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity,
      access_type, entry_instructions, address_line, sublease_doc_path,
      legal_ack_at, status, sublease_doc_state, sublease_doc_reviewed_at
    ) values
      ('${requestedSpace}', '${host}', 'Requested', 'physical', 5000, 2, 'keypad', 'Door', '1 Main St', 'lease-one.pdf', now(), 'active', 'verified', now()),
      ('${rollbackSpace}', '${host}', 'Rollback', 'physical', 5000, 2, 'keypad', 'Door', '2 Main St', 'lease-two.pdf', now(), 'delisted', 'verified', now()),
      ('${otherSpace}', '${otherHost}', 'Other', 'physical', 5000, 2, 'keypad', 'Door', '3 Main St', 'lease-three.pdf', now(), 'active', 'verified', now()),
      ('${incompleteSpace}', '${host}', 'Incomplete', 'physical', 5000, 2, 'keypad', 'Door', '4 Main St', null, now(), 'pending', 'pending', null),
      ('${completePendingSpace}', '${host}', 'Complete pending', 'physical', 5000, 2, 'keypad', 'Door', '5 Main St', 'lease-five.pdf', now(), 'pending', 'pending', null);
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("permanent listing closure", () => {
  it("removes the host's direct DELETE capability", async () => {
    await expect(
      asRole("authenticated", host, `delete from spaces where id = '${rollbackSpace}'`),
    ).rejects.toThrow(/permission denied/i);

    const row = await db.query(`select id from spaces where id = '${rollbackSpace}'`);
    expect(row.rows).toHaveLength(1);
  });

  it("keeps only a narrow rollback for a brand-new incomplete creation", async () => {
    await expect(
      asRole(
        "authenticated",
        host,
        `select discard_incomplete_listing('${otherSpace}')`,
      ),
    ).rejects.toThrow(/belongs to another host/i);

    await asRole(
      "authenticated",
      host,
      `select finalize_listing_creation('${completePendingSpace}')`,
    );
    await expect(
      asRole(
        "authenticated",
        host,
        `select discard_incomplete_listing('${completePendingSpace}')`,
      ),
    ).rejects.toThrow(/newly created incomplete listing/i);

    await asRole(
      "authenticated",
      host,
      `select discard_incomplete_listing('${incompleteSpace}')`,
    );
    const discarded = await db.query(`select id from spaces where id = '${incompleteSpace}'`);
    expect(discarded.rows).toEqual([]);
  });

  it("atomically hides the owner's listing and creates one open request", async () => {
    await asRole(
      "authenticated",
      host,
      `select request_listing_closure('${requestedSpace}', 'lease_ended', 'The lease ends Friday')`,
    );

    // A second submission updates the open request instead of creating a
    // duplicate queue item.
    await asRole(
      "authenticated",
      host,
      `select request_listing_closure('${requestedSpace}', 'lease_ended', 'The lease ends this month')`,
    );

    const listing = await db.query<{ status: string }>(
      `select status from spaces where id = '${requestedSpace}'`,
    );
    const requests = await db.query<{ detail: string }>(
      `select detail from listing_closure_requests where space_id = '${requestedSpace}' and state = 'open'`,
    );
    expect(listing.rows[0].status).toBe("delisted");
    expect(requests.rows).toEqual([{ detail: "The lease ends this month" }]);
  });

  it("does not let another host request closure", async () => {
    await expect(
      asRole(
        "authenticated",
        host,
        `select request_listing_closure('${otherSpace}', 'business_closed', null)`,
      ),
    ).rejects.toThrow(/belongs to another host/i);
  });

  it("blocks host relisting while the request is open", async () => {
    await expect(
      asRole(
        "authenticated",
        host,
        `update spaces set status = 'pending' where id = '${requestedSpace}'`,
      ),
    ).rejects.toThrow(/closure is waiting for review/i);
  });

  it("approves the request by archiving and auditing in the same transaction", async () => {
    await asRole(
      "service_role",
      admin,
      `select admin_apply_listing_action(
        '${requestedSpace}', 'approve_closure', '${admin}', 'admin@example.com', 'Host confirmed the lease ended'
      )`,
    );

    const listing = await db.query<{ status: string; archived_at: string | null }>(
      `select status, archived_at from spaces where id = '${requestedSpace}'`,
    );
    const request = await db.query<{ state: string; resolution_note: string }>(
      `select state, resolution_note from listing_closure_requests where space_id = '${requestedSpace}'`,
    );
    const audit = await db.query<{ action: string; reason: string }>(
      `select action, reason from admin_audit_log where target_id = '${requestedSpace}'`,
    );

    expect(listing.rows[0].status).toBe("delisted");
    expect(listing.rows[0].archived_at).not.toBeNull();
    expect(request.rows[0]).toEqual({
      state: "approved",
      resolution_note: "Host confirmed the lease ended",
    });
    expect(audit.rows).toEqual([
      { action: "listing_approve_closure", reason: "Host confirmed the lease ended" },
    ]);
  });

  it("rolls the listing mutation back if its audit row cannot be written", async () => {
    await db.exec("revoke insert on admin_audit_log from service_role");
    try {
      await expect(
        asRole(
          "service_role",
          admin,
          `select admin_apply_listing_action(
            '${rollbackSpace}', 'delete', '${admin}', 'admin@example.com', 'Duplicate test listing'
          )`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("grant insert on admin_audit_log to service_role");
    }

    const listing = await db.query<{ status: string }>(
      `select status from spaces where id = '${rollbackSpace}'`,
    );
    expect(listing.rows[0].status).toBe("delisted");
  });
});
