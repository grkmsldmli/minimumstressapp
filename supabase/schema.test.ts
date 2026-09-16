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
const RELIABLE_OUTBOX_MIGRATION = "20260915003724_reliable_notification_outbox.sql";
const PUSH_OUTBOX_SUPPORT_MIGRATION = "20260915093208_onesignal_push_outbox_support.sql";

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
      // +2 in 0067: blocked_users and message_reports. +1 in 0068:
      // founding_practitioners. +5 in 0069 (Work): work_preferences,
      // work_availability, class_templates, work_requests, work_interest.
      // +1 in 0070 (Studio Pro): work_roster.
      // +2 in 0073 (admin ops): analytics_events, admin_audit_log.
      // +1 in 0079: listing_closure_requests.
      // +2 in 20260914190221: signed Resend events and correlated probes.
      // +1 in 20260915025303: the private booking money-operation journal.
      // +1 in 20260916050000: the message notification transactional outbox.
      // +2 in 20260916221824: consented marketing activity and its isolated outbox.
      expect(tables.rows).toHaveLength(36);
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
      // Durable record of every state-changing admin action (0073).
      "admin_audit_log",
      // First-party product event stream, server-only (0073).
      "analytics_events",
      "availability",
      // A user severs the message channel with another (App Store 1.2, 0067).
      "blocked_users",
      // Durable Stripe/booking commit seam; browser roles cannot read it.
      "booking_money_operations",
      "bookings",
      // A studio's reusable class definition, for Work coverage (0069).
      "class_templates",
      "credit_ledger",
      // The durable Founding 50 ledger — server-only, so a spot once earned is
      // never re-opened by a deletion (migration 0060).
      "founding_hosts",
      // Its practitioner-side twin — the first fifty to complete professional
      // onboarding (verification-based), server-only and equally permanent (0068).
      "founding_practitioners",
      // Host-requested permanent closures, resolved by Command Center (0079).
      "listing_closure_requests",
      // Coarse, consent-gated timestamps only; no listing/search/device detail.
      "marketing_activity",
      // Optional lifecycle mail is isolated from transactional notifications.
      "marketing_outbox",
      // Created atomically with each message; providers are handled afterwards.
      "message_notification_jobs",
      // Booking-chat abuse reports for staff review (App Store 1.2, 0067).
      "message_reports",
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
      // Minimal signed Resend delivery evidence; server-only and append-only.
      "resend_email_events",
      // Provider IDs for Command Center probes under the current email config.
      "resend_email_probes",
      "review_escalations",
      "reviews",
      "space_media",
      // What somebody searched for when nothing came back — see 0044. Insert
      // only: there is no select policy at all, so not even a signed-in
      // account can read a row.
      "space_requests",
      "spaces",
      "studio_claims",
      // Work (0069): a practitioner's recurring weekly work availability.
      "work_availability",
      // A practitioner's interest in a coverage request, and the studio's answer.
      "work_interest",
      // A practitioner's Work opt-in and preferences.
      "work_preferences",
      // A studio's "need coverage" post, with an explicit lifecycle.
      "work_requests",
      // A studio's trusted-substitute network — invite from it, never auto-assign
      // (Studio Pro, 0070).
      "work_roster",
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

  it("gives only the service role the exact analytics ingest/report/prune privileges", async () => {
    const grants = await rows<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'analytics_events'
         and grantee in ('anon', 'authenticated', 'service_role')
       order by grantee, privilege_type`,
    );

    expect(grants).toEqual([
      { grantee: "service_role", privilege_type: "DELETE" },
      { grantee: "service_role", privilege_type: "INSERT" },
      { grantee: "service_role", privilege_type: "SELECT" },
    ]);
  });

  it("gives only the service role append-only access to Resend delivery evidence", async () => {
    const grants = await rows<{
      table_name: string;
      grantee: string;
      privilege_type: string;
    }>(
      `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in ('resend_email_events', 'resend_email_probes')
         and grantee in ('anon', 'authenticated', 'service_role')
       order by table_name, grantee, privilege_type`,
    );

    expect(grants).toEqual([
      { table_name: "resend_email_events", grantee: "service_role", privilege_type: "INSERT" },
      { table_name: "resend_email_events", grantee: "service_role", privilege_type: "SELECT" },
      { table_name: "resend_email_probes", grantee: "service_role", privilege_type: "INSERT" },
      { table_name: "resend_email_probes", grantee: "service_role", privilege_type: "SELECT" },
    ]);
  });

  it("creates the private immutable notification envelope and worker functions", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'notifications'
         and column_name in (
           'destination', 'message_snapshot', 'provider_message_id',
           'provider_correlation_id',
           'provider_status', 'accepted_at', 'delivered_at', 'failed_at',
           'next_attempt_at', 'expires_at', 'lease_token', 'lease_until'
         )
       order by column_name`,
    );

    expect(columns.map((row) => row.column_name)).toEqual([
      "accepted_at",
      "delivered_at",
      "destination",
      "expires_at",
      "failed_at",
      "lease_token",
      "lease_until",
      "message_snapshot",
      "next_attempt_at",
      "provider_correlation_id",
      "provider_message_id",
      "provider_status",
    ]);

    const financialColumns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'bookings'
         and column_name in (
           'financial_resolution_state', 'financial_resolution_attempts',
           'financial_resolution_next_attempt_at',
           'financial_resolution_last_error', 'financial_resolved_at',
           'financial_resolution_lease_token',
           'financial_resolution_lease_until'
         )
       order by column_name`,
    );
    expect(financialColumns.map((row) => row.column_name)).toEqual([
      "financial_resolution_attempts",
      "financial_resolution_last_error",
      "financial_resolution_lease_token",
      "financial_resolution_lease_until",
      "financial_resolution_next_attempt_at",
      "financial_resolution_state",
      "financial_resolved_at",
    ]);

    const routines = await rows<{ routine_name: string }>(
      `select routine_name from information_schema.routines
       where routine_schema = 'public'
         and routine_name in (
           'claim_notification_batch',
           'apply_resend_delivery_event',
           'record_notification_acceptance',
           'claim_booking_financial_resolution_batch',
           'list_booking_confirmation_notification_gaps',
           'list_cancellation_notification_gaps',
           'list_request_outcome_notification_gaps',
           'list_request_submission_notification_gaps',
           'list_host_payout_notification_gaps'
         )
       order by routine_name`,
    );
    expect(routines.map((row) => row.routine_name)).toEqual([
      "apply_resend_delivery_event",
      "claim_booking_financial_resolution_batch",
      "claim_notification_batch",
      "list_booking_confirmation_notification_gaps",
      "list_cancellation_notification_gaps",
      "list_host_payout_notification_gaps",
      "list_request_outcome_notification_gaps",
      "list_request_submission_notification_gaps",
      "record_notification_acceptance",
    ]);
  });

  it("keeps lifecycle gap reconciliation callable only by service_role", async () => {
    const grants = await rows<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee
       from information_schema.role_routine_grants
       where specific_schema = 'public'
         and routine_name in (
           'list_booking_confirmation_notification_gaps',
           'list_request_submission_notification_gaps',
           'list_host_payout_notification_gaps'
         )
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       order by routine_name, grantee`,
    );

    expect(grants).toEqual([
      {
        routine_name: "list_booking_confirmation_notification_gaps",
        grantee: "service_role",
      },
      {
        routine_name: "list_host_payout_notification_gaps",
        grantee: "service_role",
      },
      {
        routine_name: "list_request_submission_notification_gaps",
        grantee: "service_role",
      },
    ]);
  });

  it("enables row level security on every table", async () => {
    const unprotected = await rows<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and rowsecurity = false`,
    );

    expect(unprotected).toEqual([]);
  });
});

describe("durable booking financial resolution", () => {
  const HOST = "10000000-0000-4000-8000-000000000001";
  const PRACTITIONER = "10000000-0000-4000-8000-000000000002";
  const SPACE = "10000000-0000-4000-8000-000000000003";

  async function seedParties(): Promise<void> {
    await db.exec(`
      insert into auth.users (id, email) values
        ('${HOST}', 'financial-host@example.com'),
        ('${PRACTITIONER}', 'financial-practitioner@example.com')
      on conflict do nothing;
      insert into profiles (id, display_name) values
        ('${HOST}', 'Financial Host'),
        ('${PRACTITIONER}', 'Financial Practitioner')
      on conflict do nothing;
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path,
        legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${SPACE}', '${HOST}', 'Financial Room', 'physical', 4500, 3, 'keypad',
        'Side door', '12 Ledger Lane', 'active', 'space/financial/lease.pdf',
        now(), 'verified', now()
      ) on conflict do nothing;
    `);
  }

  it("backfills only financial outcomes that are safe to call resolved", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(read(STUBS));
      for (const migration of MIGRATIONS) {
        if (
          migration !== RELIABLE_OUTBOX_MIGRATION &&
          migration !== PUSH_OUTBOX_SUPPORT_MIGRATION
        ) {
          await fresh.exec(read(migration));
        }
      }

      const host = "20000000-0000-4000-8000-000000000001";
      const practitioner = "20000000-0000-4000-8000-000000000002";
      const space = "20000000-0000-4000-8000-000000000003";
      await fresh.exec(`
        insert into auth.users (id, email) values
          ('${host}', 'legacy-host@example.com'),
          ('${practitioner}', 'legacy-practitioner@example.com');
        insert into profiles (id, display_name) values
          ('${host}', 'Legacy Host'),
          ('${practitioner}', 'Legacy Practitioner');
        insert into spaces (
          id, host_id, name, category, hourly_rate_cents, capacity, access_type,
          entry_instructions, address_line, status, sublease_doc_path,
          legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
        ) values (
          '${space}', '${host}', 'Legacy Room', 'physical', 4500, 3, 'keypad',
          'Side door', '14 Ledger Lane', 'active', 'space/legacy/lease.pdf',
          now(), 'verified', now()
        );
        insert into bookings (
          id, space_id, practitioner_id, starts_at, ends_at, status,
          is_instant, was_pro, host_rate_cents, service_fee_cents,
          instant_fee_cents, pro_discount_cents, credit_applied_cents,
          total_cents, platform_cents, stripe_payment_intent_id,
          authorized_at, captured_at, cancelled_at, cancelled_by,
          approval_state, approval_decided_at
        ) values
          (
            '20000000-0000-4000-8000-000000000011', '${space}', '${practitioner}',
            now() + interval '1 day', now() + interval '1 day 1 hour',
            'cancelled_by_host', true, false, 4500, 900, 500, 0, 0, 5900, 1400,
            'pi_legacy_cancelled', now(), now(), now(), 'host',
            'not_required', null
          ),
          (
            '20000000-0000-4000-8000-000000000012', '${space}', '${practitioner}',
            now() + interval '2 days', now() + interval '2 days 1 hour',
            'upcoming', false, false, 4500, 900, 0, 0, 0, 5400, 900,
            'pi_legacy_declined', now(), null, null, null, 'declined', now()
          ),
          (
            '20000000-0000-4000-8000-000000000013', '${space}', '${practitioner}',
            now() + interval '3 days', now() + interval '3 days 1 hour',
            'upcoming', false, false, 4500, 900, 0, 0, 0, 5400, 900,
            null, null, null, null, null, 'expired', now()
          );
      `);

      await fresh.exec(read(RELIABLE_OUTBOX_MIGRATION));
      await fresh.exec(read(PUSH_OUTBOX_SUPPORT_MIGRATION));
      const result = await fresh.query<{
        id: string;
        status: string;
        cancelled_at: Date | null;
        cancelled_by: string | null;
        financial_resolution_state: string;
        financial_resolution_next_attempt_at: Date | null;
        financial_resolved_at: Date | null;
      }>(`
        select id, status, cancelled_at, cancelled_by,
          financial_resolution_state,
          financial_resolution_next_attempt_at, financial_resolved_at
        from bookings
        where id::text like '20000000-0000-4000-8000-00000000001%'
        order by id
      `);

      expect(result.rows).toEqual([
        expect.objectContaining({
          id: "20000000-0000-4000-8000-000000000011",
          status: "cancelled_by_host",
          cancelled_at: expect.any(Date),
          cancelled_by: "host",
          financial_resolution_state: "resolved",
          financial_resolution_next_attempt_at: null,
          financial_resolved_at: expect.any(Date),
        }),
        expect.objectContaining({
          id: "20000000-0000-4000-8000-000000000012",
          status: "upcoming",
          cancelled_at: expect.any(Date),
          cancelled_by: null,
          financial_resolution_state: "pending",
          financial_resolution_next_attempt_at: expect.any(Date),
          financial_resolved_at: null,
        }),
        expect.objectContaining({
          id: "20000000-0000-4000-8000-000000000013",
          status: "cancelled_by_host",
          cancelled_at: expect.any(Date),
          cancelled_by: null,
          financial_resolution_state: "resolved",
          financial_resolution_next_attempt_at: null,
          financial_resolved_at: expect.any(Date),
        }),
      ]);

      const claimed = await fresh.query<{
        id: string;
        approval_state: string;
        cancelled_at: Date | null;
      }>(`
        select id, approval_state, cancelled_at
        from claim_booking_financial_resolution_batch(
          '20000000-0000-4000-8000-000000000099', 10,
          '2099-01-01T00:00:00Z'
        )
      `);
      expect(claimed.rows).toContainEqual({
        id: "20000000-0000-4000-8000-000000000012",
        approval_state: "declined",
        cancelled_at: expect.any(Date),
      });
    } finally {
      await fresh.close();
    }
  }, 60_000);

  it("leases each due Stripe resolution once and surfaces exhausted work", async () => {
    await seedParties();
    await db.exec(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents,
        pro_discount_cents, credit_applied_cents, total_cents, platform_cents,
        stripe_payment_intent_id, approval_state, approval_decided_at,
        cancelled_at,
        financial_resolution_state, financial_resolution_attempts,
        financial_resolution_next_attempt_at
      ) values
        (
          '10000000-0000-4000-8000-000000000011', '${SPACE}', '${PRACTITIONER}',
          '2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z', false, false,
          4500, 900, 0, 0, 0, 5400, 900, 'pi_financial_due', 'declined',
          '2026-09-15T10:00:00Z', '2026-09-15T10:00:00Z',
          'pending', 0, '2026-09-15T10:00:00Z'
        ),
        (
          '10000000-0000-4000-8000-000000000012', '${SPACE}', '${PRACTITIONER}',
          '2026-09-21T12:00:00Z', '2026-09-21T13:00:00Z', false, false,
          4500, 900, 0, 0, 0, 5400, 900, 'pi_financial_exhausted', 'expired',
          '2026-09-15T10:00:00Z', '2026-09-15T10:00:00Z',
          'pending', 12, '2026-09-15T10:00:00Z'
        )
      on conflict do nothing;

    `);

    const first = await rows<{ id: string; attempts: number; lease_token: string }>(`
      select id, attempts, lease_token
      from claim_booking_financial_resolution_batch(
        '30000000-0000-4000-8000-000000000001', 200,
        '2026-09-15T11:00:00Z'
      )
    `);
    const second = await rows<{ id: string }>(`
      select id from claim_booking_financial_resolution_batch(
        '30000000-0000-4000-8000-000000000002', 200,
        '2026-09-15T11:00:00Z'
      )
    `);

    expect(first).toContainEqual({
      id: "10000000-0000-4000-8000-000000000011",
      attempts: 1,
      lease_token: "30000000-0000-4000-8000-000000000001",
    });
    expect(second.map((row) => row.id)).not.toContain(
      "10000000-0000-4000-8000-000000000011",
    );

    const [exhausted] = await rows<{
      financial_resolution_state: string;
      financial_resolution_last_error: string;
      financial_resolution_next_attempt_at: Date | null;
    }>(`
      select financial_resolution_state, financial_resolution_last_error,
        financial_resolution_next_attempt_at
      from bookings where id = '10000000-0000-4000-8000-000000000012'
    `);
    expect(exhausted).toEqual({
      financial_resolution_state: "manual_review",
      financial_resolution_last_error: "financial resolution retry attempts exhausted",
      financial_resolution_next_attempt_at: null,
    });
  });

  it("withholds financial receipts and reconciliation gaps until Stripe is resolved", async () => {
    await seedParties();
    const request = "10000000-0000-4000-8000-000000000021";
    const requestGap = "10000000-0000-4000-8000-000000000022";
    const cancellation = "10000000-0000-4000-8000-000000000023";
    const legacyAbandoned = "10000000-0000-4000-8000-000000000024";
    const legacyPreauthorized = "10000000-0000-4000-8000-000000000025";
    const recoveredPreauthorized = "10000000-0000-4000-8000-000000000026";
    await db.exec(`
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, status,
        is_instant, was_pro, host_rate_cents, service_fee_cents,
        instant_fee_cents, pro_discount_cents, credit_applied_cents,
        total_cents, platform_cents, stripe_payment_intent_id,
        authorized_at, captured_at, cancelled_at, cancelled_by,
        approval_state, approval_decided_at, financial_resolution_state,
        financial_resolution_attempts, financial_resolution_next_attempt_at
      ) values
        (
          '${request}', '${SPACE}', '${PRACTITIONER}',
          '2026-09-22T12:00:00Z', '2026-09-22T13:00:00Z', 'upcoming',
          false, false, 4500, 900, 0, 0, 0, 5400, 900, 'pi_receipt_waits',
          '2026-09-15T10:00:00Z', null, '2026-09-15T10:00:00Z', null, 'declined',
          '2026-09-15T10:00:00Z', 'pending', 0, '2026-09-16T10:00:00Z'
        ),
        (
          '${requestGap}', '${SPACE}', '${PRACTITIONER}',
          '2026-09-23T12:00:00Z', '2026-09-23T13:00:00Z', 'upcoming',
          false, false, 4500, 900, 0, 0, 0, 5400, 900, 'pi_gap_waits',
          '2026-09-15T10:00:00Z', null, '2026-09-15T10:00:00Z', null, 'expired',
          '2026-09-15T10:00:00Z', 'pending', 0, '2026-09-16T10:00:00Z'
        ),
        (
          '${cancellation}', '${SPACE}', '${PRACTITIONER}',
          '2026-09-24T12:00:00Z', '2026-09-24T13:00:00Z', 'upcoming',
          true, false, 4500, 900, 500, 0, 0, 5900, 1400,
          'pi_cancel_gap_waits', '2026-09-15T09:00:00Z',
          '2026-09-15T09:30:00Z', '2026-09-15T10:00:00Z', 'host',
          'not_required', null, 'pending', 0, '2026-09-16T10:00:00Z'
        )
      on conflict do nothing;

      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, status,
        is_instant, was_pro, host_rate_cents, service_fee_cents,
        instant_fee_cents, pro_discount_cents, credit_applied_cents,
        total_cents, platform_cents, stripe_payment_intent_id,
        authorized_at, captured_at, cancelled_at, cancelled_by,
        approval_state, financial_resolution_state,
        financial_resolution_attempts, financial_resolved_at
      ) values
        (
          '${legacyAbandoned}', '${SPACE}', '${PRACTITIONER}',
          '2026-09-25T12:00:00Z', '2026-09-25T13:00:00Z',
          'cancelled_by_practitioner', true, false, 4500, 900, 500, 0, 0,
          5900, 1400, 'pi_legacy_abandoned', null, null,
          '2026-09-15T10:00:00Z', 'practitioner', 'not_required', 'resolved',
          0, '2026-09-15T10:01:00Z'
        ),
        (
          '${legacyPreauthorized}', '${SPACE}', '${PRACTITIONER}',
          '2026-09-26T12:00:00Z', '2026-09-26T13:00:00Z',
          'cancelled_by_practitioner', false, false, 4500, 900, 0, 0, 0,
          5400, 900, 'pi_legacy_preauthorized', '2026-09-15T09:00:00Z', null,
          '2026-09-15T10:00:00Z', 'practitioner', 'pending', 'resolved',
          0, '2026-09-15T10:01:00Z'
        ),
        (
          '${recoveredPreauthorized}', '${SPACE}', '${PRACTITIONER}',
          '2026-09-27T12:00:00Z', '2026-09-27T13:00:00Z',
          'cancelled_by_practitioner', false, false, 4500, 900, 0, 0, 0,
          5400, 900, 'pi_recovered_preauthorized', '2026-09-15T09:00:00Z', null,
          '2026-09-15T10:00:00Z', 'practitioner', 'pending', 'resolved',
          1, '2026-09-15T10:01:00Z'
        )
      on conflict do nothing;

      insert into notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at
      ) values (
        '${PRACTITIONER}', '${request}', 'request_declined', 'email',
        'financial:request-receipt:waits', 'financial-practitioner@example.com',
        '{"version":1,"message":{"subject":"Declined","body":"Body","sms":null}}',
        0, '2026-09-15T10:00:00Z'
      ) on conflict (dedupe_key) do nothing;
    `);

    const beforeClaim = await rows<{ dedupe_key: string }>(`
      select dedupe_key from claim_notification_batch(
        '40000000-0000-4000-8000-000000000001', 200,
        '2026-09-15T11:00:00Z'
      )
    `);
    expect(beforeClaim.map((row) => row.dedupe_key)).not.toContain(
      "financial:request-receipt:waits",
    );

    const beforeRequestGaps = await rows<{ id: string }>(`
      select id from list_request_outcome_notification_gaps(
        '2026-09-15T00:00:00Z', 200
      )
    `);
    const beforeCancellationGaps = await rows<{ id: string }>(`
      select id from list_cancellation_notification_gaps(
        '2026-09-15T00:00:00Z', 200
      )
    `);
    expect(beforeRequestGaps.map((row) => row.id)).not.toContain(requestGap);
    expect(beforeCancellationGaps.map((row) => row.id)).not.toContain(cancellation);
    expect(beforeCancellationGaps.map((row) => row.id)).not.toContain(legacyAbandoned);
    expect(beforeCancellationGaps.map((row) => row.id)).not.toContain(
      legacyPreauthorized,
    );
    expect(beforeCancellationGaps.map((row) => row.id)).toContain(
      recoveredPreauthorized,
    );

    await db.exec(`
      update bookings
      set status = 'cancelled_by_host',
          financial_resolution_state = 'resolved',
          financial_resolution_next_attempt_at = null,
          financial_resolved_at = '2026-09-15T11:01:00Z',
          financial_resolution_lease_token = null,
          financial_resolution_lease_until = null
      where id in ('${request}', '${requestGap}', '${cancellation}');
    `);

    const afterClaim = await rows<{ dedupe_key: string }>(`
      select dedupe_key from claim_notification_batch(
        '40000000-0000-4000-8000-000000000002', 200,
        '2026-09-15T11:02:00Z'
      )
    `);
    expect(afterClaim.map((row) => row.dedupe_key)).toContain(
      "financial:request-receipt:waits",
    );

    const afterRequestGaps = await rows<{ id: string }>(`
      select id from list_request_outcome_notification_gaps(
        '2026-09-15T00:00:00Z', 200
      )
    `);
    const afterCancellationGaps = await rows<{ id: string }>(`
      select id from list_cancellation_notification_gaps(
        '2026-09-15T00:00:00Z', 200
      )
    `);
    expect(afterRequestGaps.map((row) => row.id)).toContain(requestGap);
    expect(afterCancellationGaps.map((row) => row.id)).toContain(cancellation);
  });

  it("makes the financial worker callable only by service_role", async () => {
    const [privileges] = await rows<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.claim_booking_financial_resolution_batch(uuid,integer,timestamptz)',
          'execute'
        ) as anon,
        has_function_privilege(
          'authenticated',
          'public.claim_booking_financial_resolution_batch(uuid,integer,timestamptz)',
          'execute'
        ) as authenticated,
        has_function_privilege(
          'service_role',
          'public.claim_booking_financial_resolution_batch(uuid,integer,timestamptz)',
          'execute'
        ) as service_role
    `);
    expect(privileges).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
  });
});

describe("reliable notification outbox", () => {
  const USER = "deaddead-dead-4dea-8dea-deaddeaddead";
  const HOST = "feedfeed-feed-4fee-8fee-feedfeedfeed";
  const SPACE = "acedaced-aced-4ace-8ace-acedacedaced";
  const BOOKING = "beadbead-bead-4bea-8bea-beadbeadbead";

  it("leases each due delivery to only one worker", async () => {
    await db.exec(`
      insert into auth.users (id, email)
      values ('${USER}', 'outbox@example.com') on conflict do nothing;
      insert into profiles (id, display_name)
      values ('${USER}', 'Outbox Test') on conflict do nothing;
      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        attempts, next_attempt_at
      ) values (
        '${USER}', 'payout_failed', 'email', 'outbox:lease:test',
        'outbox@example.com',
        '{"version":1,"message":{"subject":"Confirmed","body":"Body","sms":null}}',
        0, now() - interval '1 minute'
      ) on conflict (dedupe_key) do nothing;
    `);

    const first = await rows<{ dedupe_key: string }>(
      `select dedupe_key from claim_notification_batch(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200, now()
      )`,
    );
    const second = await rows<{ dedupe_key: string }>(
      `select dedupe_key from claim_notification_batch(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 200, now()
      )`,
    );

    expect(first.map((row) => row.dedupe_key)).toContain("outbox:lease:test");
    expect(second.map((row) => row.dedupe_key)).not.toContain("outbox:lease:test");
  });

  it("claims push rows and namespaces provider ids by channel", async () => {
    await db.exec(`
      insert into auth.users (id, email)
      values ('${USER}', 'outbox@example.com') on conflict do nothing;
      insert into profiles (id, display_name)
      values ('${USER}', 'Outbox Test') on conflict do nothing;

      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        attempts, next_attempt_at
      ) values (
        '${USER}', 'insurance_verified', 'push', 'outbox:push:claim',
        'ms_${"a".repeat(43)}',
        '{"version":1,"message":{"subject":"Confirmed","body":"Private email body","sms":null,"push":{"title":"Confirmed","body":"Open Minimum Stress.","url":"https://minimumstress.app/"}}}',
        0, now() - interval '1 minute'
      ) on conflict (dedupe_key) do nothing;

      insert into notifications (
        user_id, kind, channel, dedupe_key, provider_message_id,
        provider_status, sent_at
      ) values
        ('${USER}', 'booking_confirmed', 'email', 'outbox:provider-id:email',
         'shared_provider_id', 'accepted', now()),
        ('${USER}', 'booking_confirmed', 'push', 'outbox:provider-id:push',
         'shared_provider_id', 'accepted', now())
      on conflict (dedupe_key) do nothing;
    `);

    const claimed = await rows<{ dedupe_key: string }>(`
      select dedupe_key from claim_notification_batch(
        '19191919-1919-4919-8919-191919191919', 200, now()
      )
    `);
    expect(claimed.map((row) => row.dedupe_key)).toContain("outbox:push:claim");

    await expect(db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, provider_message_id,
        provider_status, sent_at
      ) values (
        '${USER}', 'new_message', 'push', 'outbox:provider-id:push-duplicate',
        'shared_provider_id', 'accepted', now()
      )
    `)).rejects.toThrow(/unique|duplicate/i);
  });

  it("never applies Resend delivery evidence to a push acceptance", async () => {
    const correlation = "d".repeat(64);
    await db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        provider_correlation_id, attempts, next_attempt_at, lease_token,
        lease_until
      ) values (
        '${USER}', 'new_message', 'push', 'outbox:push:resend-guard',
        'ms_${"b".repeat(43)}',
        '{"version":1,"message":{"subject":"Message","body":"Private email body","sms":null,"push":{"title":"New message","body":"Open Minimum Stress.","url":"https://minimumstress.app/"}}}',
        '${correlation}', 1, now(),
        '20202020-2020-4020-8020-202020202020', now() + interval '2 minutes'
      ) on conflict (dedupe_key) do nothing;

      insert into resend_email_events (
        svix_id, resend_email_id, notification_correlation_id,
        event_type, event_created_at
      ) values (
        'svix_push_guard', 'provider_push_guard', '${correlation}',
        'email.delivered', '2026-09-15T00:02:00Z'
      ) on conflict (svix_id) do nothing;

      select record_notification_acceptance(
        'outbox:push:resend-guard', 'provider_push_guard',
        '2026-09-15T00:01:00Z',
        '20202020-2020-4020-8020-202020202020'
      );
    `);

    const [state] = await rows<{
      provider_status: string;
      provider_event_at: Date | null;
    }>(`
      select provider_status, provider_event_at
      from notifications where dedupe_key = 'outbox:push:resend-guard'
    `);
    expect(state).toEqual({ provider_status: "accepted", provider_event_at: null });

    const [result] = await rows<{ affected: number }>(`
      select apply_resend_delivery_event(
        'provider_push_guard', '${correlation}',
        'email.delivered', '2026-09-15T00:03:00Z'
      ) as affected
    `);
    expect(result.affected).toBe(0);
  });

  it("does not let an older provider event regress delivery state", async () => {
    await db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        provider_message_id, provider_status, sent_at, accepted_at
      ) values (
        '${USER}', 'booking_confirmed', 'email', 'outbox:event:test',
        'outbox@example.com',
        '{"version":1,"message":{"subject":"Confirmed","body":"Body","sms":null}}',
        'email_outbox_test', 'accepted', '2026-09-15T00:00:00Z',
        '2026-09-15T00:00:00Z'
      ) on conflict (dedupe_key) do nothing;

      select apply_resend_delivery_event(
        'email_outbox_test', null, 'email.delivered', '2026-09-15T00:02:00Z'
      );
      select apply_resend_delivery_event(
        'email_outbox_test', null, 'email.delivery_delayed', '2026-09-15T00:01:00Z'
      );
    `);

    let [state] = await rows<{ provider_status: string }>(
      `select provider_status from notifications where dedupe_key = 'outbox:event:test'`,
    );
    expect(state.provider_status).toBe("delivered");

    await db.exec(`
      select apply_resend_delivery_event(
        'email_outbox_test', null, 'email.complained', '2026-09-15T00:00:00Z'
      )
    `);
    [state] = await rows<{ provider_status: string }>(
      `select provider_status from notifications where dedupe_key = 'outbox:event:test'`,
    );
    expect(state.provider_status).toBe("complained");

    await db.exec(`
      select apply_resend_delivery_event(
        'email_outbox_test', null, 'email.delivered', '2026-09-15T00:04:00Z'
      )
    `);
    [state] = await rows<{ provider_status: string }>(
      `select provider_status from notifications where dedupe_key = 'outbox:event:test'`,
    );
    expect(state.provider_status).toBe("complained");
  });

  it("lets signed delivery evidence correct a local terminal timeout", async () => {
    await db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, provider_message_id,
        provider_status, failed_at, dropped_at
      ) values (
        '${USER}', 'booking_confirmed', 'email', 'outbox:late-evidence:test',
        'email_late_evidence', 'failed', '2026-09-15T00:01:00Z',
        '2026-09-15T00:01:00Z'
      ) on conflict (dedupe_key) do nothing;

      select apply_resend_delivery_event(
        'email_late_evidence', null, 'email.delivered', '2026-09-15T00:02:00Z'
      );
    `);

    const [state] = await rows<{
      provider_status: string;
      sent_at: Date | null;
      failed_at: Date | null;
      dropped_at: Date | null;
    }>(`
      select provider_status, sent_at, failed_at, dropped_at
      from notifications where dedupe_key = 'outbox:late-evidence:test'
    `);
    expect(state).toEqual({
      provider_status: "delivered",
      sent_at: new Date("2026-09-15T00:02:00.000Z"),
      failed_at: null,
      dropped_at: null,
    });
  });

  it("uses the signed provider tag to close a timeout before the API response", async () => {
    const correlation = "b".repeat(64);
    await db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        provider_correlation_id, provider_status, attempts, next_attempt_at,
        lease_token, lease_until
      ) values (
        '${USER}', 'booking_confirmed', 'email', 'outbox:timeout:test',
        'private@example.com',
        '{"version":1,"message":{"subject":"Confirmed","body":"Body","sms":null}}',
        '${correlation}', 'queued', 1, now(),
        'abababab-abab-4aba-8aba-abababababab', now() + interval '2 minutes'
      ) on conflict (dedupe_key) do nothing;

      insert into resend_email_events (
        svix_id, resend_email_id, notification_correlation_id,
        event_type, event_created_at
      ) values (
        'svix_timeout_test', 'email_timeout_test', '${correlation}',
        'email.delivered', '2026-09-15T00:02:00Z'
      ) on conflict (svix_id) do nothing;

      select apply_resend_delivery_event(
        'email_timeout_test', '${correlation}',
        'email.delivered', '2026-09-15T00:02:00Z'
      );
    `);

    const [state] = await rows<{
      provider_message_id: string;
      provider_status: string;
      sent_at: string | null;
      destination: string | null;
      message_snapshot: unknown;
    }>(`
      select provider_message_id, provider_status, sent_at, destination, message_snapshot
      from notifications where dedupe_key = 'outbox:timeout:test'
    `);
    expect(state).toMatchObject({
      provider_message_id: "email_timeout_test",
      provider_status: "delivered",
      sent_at: expect.any(Date),
      destination: null,
      message_snapshot: null,
    });

    const claimed = await rows<{ dedupe_key: string }>(`
      select dedupe_key from claim_notification_batch(
        'acacacac-acac-4aca-8aca-acacacacacac', 200,
        '2026-09-15T01:00:00Z'
      )
    `);
    expect(claimed.map((row) => row.dedupe_key)).not.toContain("outbox:timeout:test");
  });

  it("replays the strongest stored provider event after an acceptance race", async () => {
    const correlation = "c".repeat(64);
    await db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        provider_correlation_id, attempts, next_attempt_at, lease_token, lease_until
      ) values (
        '${USER}', 'booking_confirmed', 'email', 'outbox:acceptance-race:test',
        'private@example.com',
        '{"version":1,"message":{"subject":"Confirmed","body":"Body","sms":null}}',
        '${correlation}', 1, now(),
        'adadadad-adad-4ada-8ada-adadadadadad', now() + interval '2 minutes'
      ) on conflict (dedupe_key) do nothing;

      insert into resend_email_events (
        svix_id, resend_email_id, notification_correlation_id,
        event_type, event_created_at
      ) values
        ('svix_race_delivered', 'email_acceptance_race', '${correlation}',
         'email.delivered', '2026-09-15T00:03:00Z'),
        ('svix_race_complained', 'email_acceptance_race', '${correlation}',
         'email.complained', '2026-09-15T00:02:00Z')
      on conflict (svix_id) do nothing;

      select record_notification_acceptance(
        'outbox:acceptance-race:test', 'email_acceptance_race',
        '2026-09-15T00:01:00Z', 'adadadad-adad-4ada-8ada-adadadadadad'
      );
    `);

    const [state] = await rows<{ provider_status: string; provider_event_at: Date }>(`
      select provider_status, provider_event_at
      from notifications where dedupe_key = 'outbox:acceptance-race:test'
    `);
    expect(state).toEqual({
      provider_status: "complained",
      provider_event_at: new Date("2026-09-15T00:02:00.000Z"),
    });
  });

  it("only lets the worker that owns the lease record provider acceptance", async () => {
    await db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        attempts, next_attempt_at, lease_token, lease_until
      ) values (
        '${USER}', 'payout_failed', 'email', 'outbox:fence:test',
        'outbox@example.com',
        '{"version":1,"message":{"subject":"Payout","body":"Body","sms":null}}',
        1, now(), 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', now() + interval '5 minutes'
      ) on conflict (dedupe_key) do nothing;
    `);

    const [wrong] = await rows<{ accepted: boolean }>(`
      select record_notification_acceptance(
        'outbox:fence:test', 'email_wrong_worker', now(),
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      ) as accepted
    `);
    expect(wrong.accepted).toBe(false);

    const [right] = await rows<{ accepted: boolean }>(`
      select record_notification_acceptance(
        'outbox:fence:test', 'email_right_worker', now(),
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      ) as accepted
    `);
    expect(right.accepted).toBe(true);

    const [state] = await rows<{
      provider_status: string;
      destination: string | null;
      message_snapshot: unknown;
    }>(
      `select provider_status, destination, message_snapshot
       from notifications where dedupe_key = 'outbox:fence:test'`,
    );
    expect(state).toEqual({
      provider_status: "accepted",
      destination: null,
      message_snapshot: null,
    });
  });

  it("terminally clears a final attempt whose worker lease expired", async () => {
    await db.exec(`
      insert into notifications (
        user_id, kind, channel, dedupe_key, destination, message_snapshot,
        attempts, next_attempt_at, lease_token, lease_until
      ) values (
        '${USER}', 'payout_failed', 'email', 'outbox:dead-worker:test',
        'outbox@example.com',
        '{"version":1,"message":{"subject":"Payout","body":"Body","sms":null}}',
        12, now() - interval '1 hour',
        'ffffffff-ffff-4fff-8fff-ffffffffffff', now() - interval '1 minute'
      ) on conflict (dedupe_key) do nothing;

      select * from claim_notification_batch(
        '12121212-1212-4212-8212-121212121212', 200, now()
      );
    `);

    const [state] = await rows<{
      provider_status: string;
      destination: string | null;
      message_snapshot: unknown;
      last_error: string;
    }>(
      `select provider_status, destination, message_snapshot, last_error
       from notifications where dedupe_key = 'outbox:dead-worker:test'`,
    );
    expect(state).toEqual({
      provider_status: "failed",
      destination: null,
      message_snapshot: null,
      last_error: "notification retry attempts exhausted",
    });
  });

  it("drops every queued active notification while cancellation money is pending", async () => {
    const approvedBooking = "11111111-aaaa-4aaa-8aaa-111111111111";
    const heldRequest = "22222222-bbbb-4bbb-8bbb-222222222222";
    await db.exec(`
      insert into auth.users (id, email) values
        ('${HOST}', 'outbox-host@example.com') on conflict do nothing;
      insert into profiles (id, display_name) values
        ('${HOST}', 'Outbox Host') on conflict do nothing;
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path,
        legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${SPACE}', '${HOST}', 'Outbox Room', 'physical', 4500, 3, 'keypad',
        'Side door', '12 Test Lane', 'active', 'space/outbox/lease.pdf',
        now(), 'verified', now()
      ) on conflict do nothing;
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents,
        pro_discount_cents, credit_applied_cents, total_cents, platform_cents,
        approval_state, stripe_payment_intent_id, authorized_at, captured_at,
        cancelled_at, cancelled_by, access_code, access_code_revealed_at,
        financial_resolution_state, financial_resolution_next_attempt_at
      ) values
        (
          '${BOOKING}', '${SPACE}', '${USER}', now() + interval '20 minutes',
          now() + interval '80 minutes', true, false, 4500, 900, 500,
          0, 0, 5900, 1400, 'not_required', 'pi_pending_cancel_instant',
          now(), now(), now(), 'host', '4821', now() - interval '1 minute',
          'pending', now()
        ),
        (
          '${approvedBooking}', '${SPACE}', '${USER}', now() + interval '100 minutes',
          now() + interval '160 minutes', false, false, 4500, 900, 0,
          0, 0, 5400, 900, 'approved', 'pi_pending_cancel_approved',
          now(), now(), now(), 'host', null, null, 'pending', now()
        ),
        (
          '${heldRequest}', '${SPACE}', '${USER}', now() + interval '180 minutes',
          now() + interval '240 minutes', false, false, 4500, 900, 0,
          0, 0, 5400, 900, 'pending', 'pi_pending_cancel_request',
          now(), null, now(), 'host', null, null, 'pending', now()
        )
      on conflict do nothing;
      insert into notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at, expires_at
      ) values
        (
          '${USER}', '${BOOKING}', 'booking_confirmed', 'email',
          'outbox:pending-cancellation:booking-confirmed', 'outbox@example.com',
          '{"version":1,"message":{"subject":"Confirmed","body":"Body","sms":null}}',
          0, now() - interval '1 minute', null
        ),
        (
          '${HOST}', '${BOOKING}', 'host_new_booking', 'email',
          'outbox:pending-cancellation:host-new-booking', 'outbox-host@example.com',
          '{"version":1,"message":{"subject":"New booking","body":"Body","sms":null}}',
          0, now() - interval '1 minute', null
        ),
        (
          '${USER}', '${BOOKING}', 'access_code_ready', 'email',
          'outbox:pending-cancellation:access-code', 'outbox@example.com',
          '{"version":1,"message":{"subject":"Door code","body":"4821","sms":"4821"}}',
          1, now() - interval '1 minute', now() + interval '80 minutes'
        ),
        (
          '${USER}', '${BOOKING}', 'new_message', 'email',
          'outbox:pending-cancellation:new-message', 'outbox@example.com',
          '{"version":1,"message":{"subject":"New message","body":"Body","sms":null}}',
          0, now() - interval '1 minute', null
        ),
        (
          '${USER}', '${approvedBooking}', 'request_approved', 'email',
          'outbox:pending-cancellation:request-approved', 'outbox@example.com',
          '{"version":1,"message":{"subject":"Approved","body":"Body","sms":null}}',
          0, now() - interval '1 minute', null
        ),
        (
          '${HOST}', '${heldRequest}', 'host_new_request', 'email',
          'outbox:pending-cancellation:host-new-request', 'outbox-host@example.com',
          '{"version":1,"message":{"subject":"New request","body":"Body","sms":null}}',
          0, now() - interval '1 minute', null
        ),
        (
          '${HOST}', '${heldRequest}', 'host_request_reminder', 'email',
          'outbox:pending-cancellation:host-request-reminder', 'outbox-host@example.com',
          '{"version":1,"message":{"subject":"Request reminder","body":"Body","sms":null}}',
          0, now() - interval '1 minute', null
        )
      on conflict (dedupe_key) do nothing;
    `);

    const claimed = await rows<{ dedupe_key: string }>(
      `select dedupe_key from claim_notification_batch(
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 200, now()
      )`,
    );
    const staleKeys = [
      "outbox:pending-cancellation:booking-confirmed",
      "outbox:pending-cancellation:host-new-booking",
      "outbox:pending-cancellation:access-code",
      "outbox:pending-cancellation:new-message",
      "outbox:pending-cancellation:request-approved",
      "outbox:pending-cancellation:host-new-request",
      "outbox:pending-cancellation:host-request-reminder",
    ];
    const claimedKeys = claimed.map((row) => row.dedupe_key);
    for (const key of staleKeys) {
      expect(claimedKeys).not.toContain(key);
    }

    const states = await rows<{
      dedupe_key: string;
      provider_status: string;
      destination: string | null;
      message_snapshot: unknown;
    }>(
      `select dedupe_key, provider_status, destination, message_snapshot
       from notifications
       where dedupe_key like 'outbox:pending-cancellation:%'
       order by dedupe_key`,
    );
    expect(states).toHaveLength(staleKeys.length);
    for (const state of states) {
      expect(state).toEqual({
        dedupe_key: state.dedupe_key,
        provider_status: "failed",
        destination: null,
        message_snapshot: null,
      });
    }
  });

  it("finds either side of a captured direct-booking confirmation gap", async () => {
    const host = "a1111111-1111-4111-8111-111111111111";
    const practitioner = "a2222222-2222-4222-8222-222222222222";
    const space = "a3333333-3333-4333-8333-333333333333";
    const booking = "a4444444-4444-4444-8444-444444444444";
    const approvedRequest = "a5555555-5555-4555-8555-555555555555";
    const activeBooking = "a6666666-6666-4666-8666-666666666666";
    const activeOperation = "a7777777-7777-4777-8777-777777777777";

    await db.exec(`
      insert into auth.users (id, email) values
        ('${host}', 'confirmation-host@example.com'),
        ('${practitioner}', 'confirmation-practitioner@example.com')
      on conflict do nothing;
      insert into profiles (id, display_name, notify_bookings) values
        ('${host}', 'Confirmation Host', true),
        ('${practitioner}', 'Confirmation Practitioner', true)
      on conflict do nothing;
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path,
        legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${space}', '${host}', 'Confirmation Room', 'physical', 4500, 3, 'keypad',
        'Side door', '12 Test Lane', 'active', 'space/confirmation/lease.pdf',
        now(), 'verified', now()
      ) on conflict do nothing;
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, status,
        is_instant, was_pro, host_rate_cents, service_fee_cents,
        instant_fee_cents, pro_discount_cents, credit_applied_cents,
        total_cents, platform_cents, approval_state,
        stripe_payment_intent_id, captured_at
      ) values
        (
          '${booking}', '${space}', '${practitioner}', now() + interval '2 days',
          now() + interval '2 days 1 hour', 'upcoming', true, false, 4500, 900,
          500, 0, 0, 5900, 1400, 'not_required', 'pi_confirmation_gap', now()
        ),
        (
          '${approvedRequest}', '${space}', '${practitioner}', now() + interval '3 days',
          now() + interval '3 days 1 hour', 'upcoming', false, false, 4500, 900,
          0, 0, 0, 5400, 900, 'approved', 'pi_approved_gap', now()
        ),
        (
          '${activeBooking}', '${space}', '${practitioner}', now() + interval '4 days',
          now() + interval '4 days 1 hour', 'upcoming', true, false, 4500, 900,
          500, 0, 0, 5900, 1400, 'not_required', 'pi_active_gap', now()
        )
      on conflict do nothing;
      insert into booking_money_operations (
        id, booking_id, kind, state, operation_key, cancellation_actor,
        provider_action, space_id, practitioner_id, payment_intent_id,
        host_rate_cents, service_fee_cents, instant_fee_cents,
        pro_discount_cents, total_cents, platform_cents
      ) values (
        '${activeOperation}', '${activeBooking}', 'cancellation', 'claimed',
        'booking:${activeBooking}:confirmation-test', 'practitioner', 'refund',
        '${space}', '${practitioner}', 'pi_active_gap', 4500, 900, 500, 0, 5900, 1400
      ) on conflict do nothing;
      update bookings set active_money_operation_id = '${activeOperation}'
      where id = '${activeBooking}';
    `);

    let gaps = await rows<{ id: string }>(`
      select id from list_booking_confirmation_notification_gaps(
        now() - interval '1 day', now(), 100
      )
    `);
    expect(gaps.map((row) => row.id)).toContain(booking);
    expect(gaps.map((row) => row.id)).not.toContain(approvedRequest);
    expect(gaps.map((row) => row.id)).not.toContain(activeBooking);

    await db.exec(`
      insert into notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at, expires_at
      ) values (
        '${practitioner}', '${booking}', 'booking_confirmed', 'email',
        'booking_confirmed:${booking}:email', 'confirmation-practitioner@example.com',
        '{"version":1,"message":{"subject":"Confirmed","body":"Booked","sms":null}}',
        0, now(), now() + interval '2 days'
      );
    `);

    // One claimed receipt must not hide a crash before the other side's claim.
    gaps = await rows<{ id: string }>(`
      select id from list_booking_confirmation_notification_gaps(
        now() - interval '1 day', now(), 100
      )
    `);
    expect(gaps.map((row) => row.id)).toContain(booking);

    // A host who opted out is not an outstanding delivery gap.
    await db.exec(`update profiles set notify_bookings = false where id = '${host}'`);
    gaps = await rows<{ id: string }>(`
      select id from list_booking_confirmation_notification_gaps(
        now() - interval '1 day', now(), 100
      )
    `);
    expect(gaps.map((row) => row.id)).not.toContain(booking);

    await db.exec(`
      update profiles set notify_bookings = true where id = '${host}';
      insert into notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at, expires_at
      ) values (
        '${host}', '${booking}', 'host_new_booking', 'email',
        'host_new_booking:${booking}:email', 'confirmation-host@example.com',
        '{"version":1,"message":{"subject":"New booking","body":"Booked","sms":null}}',
        0, now(), now() + interval '2 days'
      );
    `);

    gaps = await rows<{ id: string }>(`
      select id from list_booking_confirmation_notification_gaps(
        now() - interval '1 day', now(), 100
      )
    `);
    expect(gaps.map((row) => row.id)).not.toContain(booking);
  });

  it("repairs either side of a held-request crash and drops stale request receipts", async () => {
    const host = "10101010-1010-4010-8010-101010101010";
    const practitioner = "20202020-2020-4020-8020-202020202020";
    const space = "30303030-3030-4030-8030-303030303030";
    const booking = "40404040-4040-4040-8040-404040404040";

    await db.exec(`
      insert into auth.users (id, email) values
        ('${host}', 'request-host@example.com'),
        ('${practitioner}', 'request-practitioner@example.com')
      on conflict do nothing;
      insert into profiles (id, display_name) values
        ('${host}', 'Request Host'),
        ('${practitioner}', 'Request Practitioner')
      on conflict do nothing;
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path,
        legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${space}', '${host}', 'Request Room', 'physical', 4500, 3, 'keypad',
        'Side door', '12 Test Lane', 'active', 'space/request/lease.pdf',
        now(), 'verified', now()
      ) on conflict do nothing;
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents,
        pro_discount_cents, credit_applied_cents, total_cents, platform_cents,
        approval_state, authorized_at
      ) values (
        '${booking}', '${space}', '${practitioner}', now() + interval '2 days',
        now() + interval '2 days 1 hour', false, false, 4500, 900, 0,
        0, 0, 5400, 900, 'pending', now()
      ) on conflict do nothing;
    `);

    let gaps = await rows<{ id: string }>(`
      select id from list_request_submission_notification_gaps(
        now() - interval '1 day', now(), 100
      )
    `);
    expect(gaps.map((row) => row.id)).toContain(booking);

    await db.exec(`
      insert into notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at, expires_at
      ) values (
        '${practitioner}', '${booking}', 'request_submitted', 'email',
        'request_submitted:${booking}:email', 'request-practitioner@example.com',
        '{"version":1,"message":{"subject":"Request sent","body":"Held, not charged","sms":null}}',
        0, now(), now() + interval '1 day'
      );
    `);

    // The practitioner receipt alone must not hide a crash before the host
    // notification was claimed.
    gaps = await rows<{ id: string }>(`
      select id from list_request_submission_notification_gaps(
        now() - interval '1 day', now(), 100
      )
    `);
    expect(gaps.map((row) => row.id)).toContain(booking);

    await db.exec(`
      insert into notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at, expires_at
      ) values (
        '${host}', '${booking}', 'host_new_request', 'email',
        'host_new_request:${booking}:email', 'request-host@example.com',
        '{"version":1,"message":{"subject":"New request","body":"Review it","sms":null}}',
        0, now(), now() + interval '1 day'
      );
      update bookings
      set approval_state = 'approved', approval_decided_at = now(), captured_at = now()
      where id = '${booking}';
    `);

    gaps = await rows<{ id: string }>(`
      select id from list_request_submission_notification_gaps(
        now() - interval '1 day', now(), 100
      )
    `);
    expect(gaps.map((row) => row.id)).not.toContain(booking);

    const claimed = await rows<{ dedupe_key: string }>(`
      select dedupe_key from claim_notification_batch(
        '41414141-4141-4141-8141-414141414141', 200, now()
      )
    `);
    expect(claimed.map((row) => row.dedupe_key)).not.toContain(
      `request_submitted:${booking}:email`,
    );

    const [state] = await rows<{ provider_status: string; destination: string | null }>(`
      select provider_status, destination from notifications
      where dedupe_key = 'request_submitted:${booking}:email'
    `);
    expect(state).toEqual({ provider_status: "failed", destination: null });
  });

  it("finds durable payout gaps, respects preference, and rejects premature receipts", async () => {
    const host = "50505050-5050-4050-8050-505050505050";
    const practitioner = "60606060-6060-4060-8060-606060606060";
    const space = "70707070-7070-4070-8070-707070707070";
    const paidBooking = "80808080-8080-4080-8080-808080808080";
    const unpaidBooking = "90909090-9090-4090-8090-909090909090";

    await db.exec(`
      insert into auth.users (id, email) values
        ('${host}', 'payout-host@example.com'),
        ('${practitioner}', 'payout-practitioner@example.com')
      on conflict do nothing;
      insert into profiles (id, display_name, notify_payouts) values
        ('${host}', 'Payout Host', false),
        ('${practitioner}', 'Payout Practitioner', true)
      on conflict do nothing;
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path,
        legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${space}', '${host}', 'Payout Room', 'physical', 4500, 3, 'keypad',
        'Side door', '12 Test Lane', 'active', 'space/payout/lease.pdf',
        now(), 'verified', now()
      ) on conflict do nothing;
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, status,
        is_instant, was_pro, host_rate_cents, service_fee_cents,
        instant_fee_cents, pro_discount_cents, credit_applied_cents,
        total_cents, platform_cents, captured_at, host_paid_at,
        stripe_transfer_id
      ) values
        (
          '${paidBooking}', '${space}', '${practitioner}', now() - interval '2 hours',
          now() - interval '1 hour', 'completed', true, false, 4500, 900,
          500, 0, 0, 5900, 1400, now() - interval '2 days', now(), 'tr_paid'
        ),
        (
          '${unpaidBooking}', '${space}', '${practitioner}', now() - interval '2 hours',
          now() - interval '1 hour', 'completed', true, false, 4500, 900,
          500, 0, 0, 5900, 1400, now() - interval '2 days', null, null
        )
      on conflict do nothing;

      insert into booking_money_operations (
        booking_id, kind, state, operation_key, provider_action,
        space_id, practitioner_id, host_rate_cents, service_fee_cents,
        instant_fee_cents, pro_discount_cents, total_cents, platform_cents,
        expected_transfer_cents, stripe_transfer_id, provider_status,
        completed_at
      ) values (
        '${paidBooking}', 'payout', 'committed',
        'booking:${paidBooking}:payout', 'transfer', '${space}',
        '${practitioner}', 4500, 900, 500, 0, 5900, 1400, 4500,
        'tr_paid', 'succeeded', now()
      ) on conflict (operation_key) do nothing;
    `);

    let gaps = await rows<{ id: string }>(`
      select id from list_host_payout_notification_gaps(now() - interval '1 day', 100)
    `);
    expect(gaps.map((row) => row.id)).not.toContain(paidBooking);

    await db.exec(`update profiles set notify_payouts = true where id = '${host}'`);
    gaps = await rows<{ id: string }>(`
      select id from list_host_payout_notification_gaps(now() - interval '1 day', 100)
    `);
    expect(gaps.map((row) => row.id)).toContain(paidBooking);

    await db.exec(`
      insert into notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at
      ) values
        (
          '${host}', '${paidBooking}', 'host_payout_sent', 'email',
          'host_payout_sent:${paidBooking}:email', 'payout-host@example.com',
          '{"version":1,"message":{"subject":"Sent to Stripe","body":"Transfer complete","sms":null}}',
          0, now()
        ),
        (
          '${host}', '${unpaidBooking}', 'host_payout_sent', 'email',
          'host_payout_sent:${unpaidBooking}:email', 'payout-host@example.com',
          '{"version":1,"message":{"subject":"Sent to Stripe","body":"Transfer complete","sms":null}}',
          0, now()
        );
    `);

    gaps = await rows<{ id: string }>(`
      select id from list_host_payout_notification_gaps(now() - interval '1 day', 100)
    `);
    expect(gaps.map((row) => row.id)).not.toContain(paidBooking);

    const claimed = await rows<{ dedupe_key: string }>(`
      select dedupe_key from claim_notification_batch(
        '91919191-9191-4191-8191-919191919191', 200, now()
      )
    `);
    expect(claimed.map((row) => row.dedupe_key)).toContain(
      `host_payout_sent:${paidBooking}:email`,
    );
    expect(claimed.map((row) => row.dedupe_key)).not.toContain(
      `host_payout_sent:${unpaidBooking}:email`,
    );

    const [premature] = await rows<{ provider_status: string; destination: string | null }>(`
      select provider_status, destination from notifications
      where dedupe_key = 'host_payout_sent:${unpaidBooking}:email'
    `);
    expect(premature).toEqual({ provider_status: "failed", destination: null });
  });

  it("allows declined and expired requests to end without inventing an actor", async () => {
    const host = "11111111-2222-4333-8444-555555555555";
    const practitioner = "66666666-7777-4888-8999-000000000000";
    const space = "12121212-3434-4565-8787-909090909090";
    const booking = "98989898-7676-4545-8323-101010101010";
    await db.exec(`
      insert into auth.users (id, email) values
        ('${host}', 'decline-host@example.com'),
        ('${practitioner}', 'decline-practitioner@example.com')
      on conflict do nothing;
      insert into profiles (id, display_name) values
        ('${host}', 'Decline Host'),
        ('${practitioner}', 'Decline Practitioner')
      on conflict do nothing;
      insert into spaces (
        id, host_id, name, category, hourly_rate_cents, capacity, access_type,
        entry_instructions, address_line, status, sublease_doc_path,
        legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
      ) values (
        '${space}', '${host}', 'Decline Room', 'physical', 4500, 3, 'keypad',
        'Side door', '12 Test Lane', 'active', 'space/decline/lease.pdf',
        now(), 'verified', now()
      ) on conflict do nothing;
      insert into bookings (
        id, space_id, practitioner_id, starts_at, ends_at, is_instant, was_pro,
        host_rate_cents, service_fee_cents, instant_fee_cents,
        pro_discount_cents, credit_applied_cents, total_cents, platform_cents,
        approval_state, authorized_at
      ) values (
        '${booking}', '${space}', '${practitioner}', now() + interval '2 days',
        now() + interval '2 days 1 hour', false, false, 4500, 900, 0,
        0, 0, 5400, 900, 'pending', now()
      ) on conflict do nothing;

      update bookings
      set approval_state = 'declined', approval_decided_at = now(),
          status = 'cancelled_by_host', cancelled_at = now(), cancelled_by = null
      where id = '${booking}';
    `);

    const [state] = await rows<{
      approval_state: string;
      cancelled_at: string | null;
      cancelled_by: string | null;
    }>(`
      select approval_state, cancelled_at, cancelled_by
      from bookings where id = '${booking}'
    `);
    expect(state).toMatchObject({
      approval_state: "declined",
      cancelled_at: expect.any(Date),
      cancelled_by: null,
    });

    await db.exec(`
      update bookings
      set approval_state = 'expired'
      where id = '${booking}'
    `);
    const [expired] = await rows<{ approval_state: string; cancelled_by: string | null }>(`
      select approval_state, cancelled_by from bookings where id = '${booking}'
    `);
    expect(expired).toEqual({ approval_state: "expired", cancelled_by: null });
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

  it("runs every exposed view as the caller", async () => {
    // 0074 moves privileged implementations into the unexposed private schema.
    // Every stable public.* API name is now a SECURITY INVOKER facade, which
    // satisfies Security Advisor without granting callers the base tables.
    // The private backing views retain the curated definer projections.
    const PER_USER = [
      "credit_balances",
      "bookings_with_access_code",
      "messages_visible",
      "my_notifications",
    ];
    const PUBLIC = [
      "spaces_public",
      "public_host_profiles",
      "availability_public",
      "space_media_public",
      "public_reviews",
      "space_ratings",
      "city_inventory",
      "city_type_inventory",
      "city_category_inventory",
      "space_demand",
    ];
    const SELF_FILTERED = ["session_counts"];

    const views = await rows<{ viewname: string; options: string[] | null }>(
      `select c.relname as viewname, c.reloptions as options
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'`,
    );
    const optionsFor = (name: string) =>
      views.find((v) => v.viewname === name)?.options ?? [];

    const exposed = [...PER_USER, ...PUBLIC, ...SELF_FILTERED];
    expect(views.map((v) => v.viewname).sort()).toEqual(exposed.sort());

    for (const name of exposed) {
      expect(optionsFor(name), `${name} must be security_invoker`).toContain(
        "security_invoker=true",
      );
    }
  });

  it("exposes access details through an invoker facade backed by a pinned private definer", async () => {
    const [facade] = await rows<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'space_access_details'`,
    );
    const [backing] = await rows<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = '_ms_space_access_details_definer'`,
    );

    expect(facade.prosecdef).toBe(false);
    expect(facade.proconfig ?? []).toContain("search_path=pg_catalog");
    expect(backing.prosecdef).toBe(true);
    expect(backing.proconfig ?? []).toContain("search_path=public");
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
