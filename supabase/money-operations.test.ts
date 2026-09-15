import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The money journal is the transaction boundary between Postgres and Stripe.
 * These tests deliberately exercise it as SQL, not through a mocked gateway:
 * the row locks, partial unique index, lease fence and multi-row completions
 * are the guarantees that prevent a payout and refund from both winning.
 */
const migrationsDir = join(import.meta.dirname, "migrations");
const STUBS = "0000_supabase_stubs.sql";
const MONEY_MIGRATION = "20260915025303_booking_money_operation_journal.sql";
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const HOST = "11111111-1111-4111-8111-111111111111";
const PRACTITIONER = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const SPACE = "44444444-4444-4444-8444-444444444444";

const PAYOUT_BOOKING = "55555555-5555-4555-8555-555555555555";
const FUTURE_BOOKING = "66666666-6666-4666-8666-666666666666";
const REFUND_BOOKING = "77777777-7777-4777-8777-777777777777";
const PAID_BOOKING = "88888888-8888-4888-8888-888888888888";
const REFUND_REQUEST = "99999999-9999-4999-8999-999999999999";
const PAID_REFUND_REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const TOKEN_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN_C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T0 = "2026-09-15T12:00:00.000Z";

type Operation = {
  id: string;
  booking_id: string;
  refund_request_id: string | null;
  kind: "payout" | "cancellation" | "refund_request";
  state: "claimed" | "provider_pending" | "committed" | "manual_review";
  requested_outcome: "full" | "our_fee" | "none" | null;
  provider_action: string;
  expected_refund_cents: number;
  expected_reversal_cents: number;
  attempts: number;
  lease_token: string | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  stripe_reversal_id: string | null;
  provider_status: string | null;
};

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

async function asRole<T = Record<string, unknown>>(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql)).rows;
  }) as Promise<T[]>;
}

async function seedBase(target: PGlite = db): Promise<void> {
  await target.exec(`
    insert into auth.users (id, email) values
      ('${HOST}', 'money-host@example.com'),
      ('${PRACTITIONER}', 'money-practitioner@example.com'),
      ('${STAFF}', 'money-staff@example.com');

    insert into public.profiles (
      id, display_name, account_type, stripe_connect_account_id
    ) values
      ('${HOST}', 'Money Host', 'host', 'acct_money_host'),
      ('${PRACTITIONER}', 'Money Practitioner', 'practitioner', null),
      ('${STAFF}', 'Money Staff', null, null);

    insert into public.spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path,
      legal_ack_at, sublease_doc_state, sublease_doc_reviewed_at
    ) values (
      '${SPACE}', '${HOST}', 'Money Room', 'physical', 4500, 4, 'keypad',
      'Side door', '12 Ledger Lane', 'active', 'space/money/lease.pdf',
      '${T0}'::timestamptz - interval '30 days', 'verified',
      '${T0}'::timestamptz - interval '29 days'
    );
  `);
}

async function insertBooking(options: {
  id: string;
  startsAt: string;
  endsAt: string;
  captured?: boolean;
  hostPaid?: boolean;
  status?: string;
  paymentIntent?: string | null;
}): Promise<void> {
  const capturedAt = options.captured === false
    ? "null"
    : `'${T0}'::timestamptz - interval '2 days'`;
  const hostPaidAt = options.hostPaid
    ? `'${T0}'::timestamptz - interval '1 hour'`
    : "null";
  const transferId = options.hostPaid ? `'tr_${options.id.slice(0, 8)}'` : "null";
  const paymentIntent = options.paymentIntent === null
    ? "null"
    : `'${options.paymentIntent ?? `pi_${options.id.slice(0, 8)}`}'`;

  await db.exec(`
    insert into public.bookings (
      id, space_id, practitioner_id, starts_at, ends_at, status,
      is_instant, was_pro, host_rate_cents, service_fee_cents,
      instant_fee_cents, pro_discount_cents, credit_applied_cents,
      total_cents, platform_cents, stripe_payment_intent_id, captured_at,
      host_paid_at, stripe_transfer_id
    ) values (
      '${options.id}', '${SPACE}', '${PRACTITIONER}',
      '${options.startsAt}'::timestamptz, '${options.endsAt}'::timestamptz,
      '${options.status ?? "upcoming"}', true, false,
      4500, 900, 0, 0, 0, 5400, 900, ${paymentIntent}, ${capturedAt},
      ${hostPaidAt}, ${transferId}
    );
  `);
}

async function insertRefundRequest(
  id: string,
  bookingId: string,
  state = "awaiting_staff",
): Promise<void> {
  await db.exec(`
    insert into public.refund_requests (
      id, booking_id, practitioner_id, reason, detail, state, created_at
    ) values (
      '${id}', '${bookingId}', '${PRACTITIONER}', 'no_access',
      'Could not enter the room', '${state}', '${T0}'::timestamptz
    );
  `);
}

async function claimPayout(
  bookingId: string,
  token: string,
  now = T0,
): Promise<Operation[]> {
  return rows<Operation>(`
    select * from public.claim_booking_payout(
      '${bookingId}', '${token}', '${now}'::timestamptz
    )
  `);
}

async function claimCancellation(options: {
  bookingId: string;
  token: string;
  actor?: "host" | "practitioner";
  providerAction?: "refund" | "cancel_intent" | "none";
  refundCents?: number;
  chargedCents?: number;
  now?: string;
}): Promise<Operation[]> {
  const actor = options.actor ?? "host";
  const requester = actor === "host" ? HOST : PRACTITIONER;
  return rows<Operation>(`
    select * from public.claim_booking_cancellation(
      '${options.bookingId}', '${actor}'::public.cancelled_by_actor,
      '${requester}', '${options.providerAction ?? "refund"}',
      ${options.refundCents ?? 5400}, ${options.chargedCents ?? 0},
      '${options.token}', '${options.now ?? T0}'::timestamptz
    )
  `);
}

async function claimRefund(options: {
  requestId: string;
  token: string;
  outcome?: "full" | "our_fee" | "none";
  now?: string;
}): Promise<Operation[]> {
  return rows<Operation>(`
    select * from public.claim_refund_decision(
      '${options.requestId}', '${STAFF}',
      '${options.outcome ?? "full"}'::public.refund_outcome,
      'Reviewed evidence', '${options.token}',
      '${options.now ?? T0}'::timestamptz
    )
  `);
}

beforeAll(async () => {
  expect(migrations).toContain(MONEY_MIGRATION);
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of migrations) await db.exec(read(migration));
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate table public.booking_money_operations, public.refund_requests,
      public.bookings, public.spaces, public.profiles, auth.users cascade;
  `);
  await seedBase();
});

afterAll(async () => {
  await db?.close();
});

describe("booking money journal security boundary", () => {
  it("enables RLS and exposes the journal only to service_role", async () => {
    const [table] = await rows<{ rowsecurity: boolean }>(`
      select rowsecurity from pg_tables
      where schemaname = 'public' and tablename = 'booking_money_operations'
    `);
    expect(table.rowsecurity).toBe(true);

    const grants = await rows<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'booking_money_operations'
        and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      order by grantee, privilege_type
    `);
    expect(grants.filter((grant) => grant.grantee !== "service_role")).toEqual([]);
    expect(
      grants
        .filter((grant) => grant.grantee === "service_role")
        .map((grant) => grant.privilege_type),
    ).toEqual(expect.arrayContaining(["INSERT", "SELECT", "UPDATE"]));

    await expect(
      asRole("authenticated", `select * from public.booking_money_operations`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("anon", `select * from public.booking_money_operations`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("service_role", `select * from public.booking_money_operations`),
    ).resolves.toEqual([]);
  });

  it("keeps every claim, retry, failure and completion RPC service-role only", async () => {
    const names = [
      "claim_booking_cancellation",
      "claim_booking_money_operation_retries",
      "claim_booking_payout",
      "claim_refund_decision",
      "complete_booking_cancellation",
      "complete_booking_payout",
      "complete_refund_decision",
      "fail_booking_money_operation",
      "booking_money_operation_may_claim",
      "project_booking_money_manual_review",
      "notification_delivery_is_current",
      "list_refund_decision_notification_gaps",
    ];
    const privileges = await rows<{
      routine: string;
      public_exec: boolean;
      anon_exec: boolean;
      authenticated_exec: boolean;
      service_exec: boolean;
    }>(`
      select
        p.oid::regprocedure::text as routine,
        has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(array[${names.map((name) => `'${name}'`).join(",")}])
      order by p.proname
    `);

    expect(privileges).toHaveLength(names.length);
    expect(
      privileges.every(
        (row) =>
          !row.public_exec &&
          !row.anon_exec &&
          !row.authenticated_exec &&
          row.service_exec,
      ),
    ).toBe(true);

    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });
    await expect(
      asRole(
        "authenticated",
        `select * from public.claim_booking_payout(
          '${PAYOUT_BOOKING}', '${TOKEN_A}', '${T0}'::timestamptz
        )`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("rejects missing worker and lease fencing tokens explicitly", async () => {
    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });
    await insertBooking({
      id: FUTURE_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, PAYOUT_BOOKING);

    await expect(rows(`select * from public.claim_booking_payout(
      '${PAYOUT_BOOKING}', null::uuid, '${T0}'::timestamptz
    )`)).rejects.toThrow(/p_lease_token is required/i);
    await expect(rows(`select * from public.claim_booking_cancellation(
      '${FUTURE_BOOKING}', 'host', '${HOST}', 'refund', 5400, 0,
      null::uuid, '${T0}'::timestamptz
    )`)).rejects.toThrow(/p_lease_token is required/i);
    await expect(rows(`select * from public.claim_refund_decision(
      '${REFUND_REQUEST}', '${STAFF}', 'full', 'Reviewed', null::uuid,
      '${T0}'::timestamptz
    )`)).rejects.toThrow(/p_lease_token is required/i);
    await expect(rows(`select * from public.claim_booking_money_operation_retries(
      null::uuid, 25, '${T0}'::timestamptz
    )`)).rejects.toThrow(/p_worker is required/i);
  });
});

describe("one active money operation per booking", () => {
  it("backs the booking pointer with a partial unique constraint", async () => {
    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });
    const [payout] = await claimPayout(PAYOUT_BOOKING, TOKEN_A);

    await expect(
      db.exec(`
        insert into public.booking_money_operations (
          booking_id, kind, operation_key, cancellation_actor, provider_action,
          space_id, practitioner_id, payment_intent_id,
          host_rate_cents, service_fee_cents, instant_fee_cents,
          pro_discount_cents, total_cents, platform_cents,
          refunded_before_cents, expected_refund_cents, expected_charged_cents
        ) select
          booking_id, 'cancellation', 'test:second-active', 'host', 'none',
          space_id, practitioner_id, payment_intent_id,
          host_rate_cents, service_fee_cents, instant_fee_cents,
          pro_discount_cents, total_cents, platform_cents,
          refunded_before_cents, 0, total_cents
        from public.booking_money_operations where id = '${payout.id}'
      `),
    ).rejects.toThrow(/booking_money_operations_one_active_per_booking|unique/i);
  });

  it("lets a payout claim exclude a competing refund decision", async () => {
    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, PAYOUT_BOOKING);

    const [payout] = await claimPayout(PAYOUT_BOOKING, TOKEN_A);
    expect(payout.kind).toBe("payout");
    expect(await claimRefund({ requestId: REFUND_REQUEST, token: TOKEN_B })).toEqual([]);

    const [request] = await rows<{ state: string; outcome: string | null }>(`
      select state, outcome from public.refund_requests where id = '${REFUND_REQUEST}'
    `);
    expect(request).toEqual({ state: "awaiting_staff", outcome: null });
  });

  it("rechecks the booking after cancellation, so a stale payout candidate loses", async () => {
    await insertBooking({
      id: FUTURE_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
    });

    const [cancellation] = await claimCancellation({
      bookingId: FUTURE_BOOKING,
      token: TOKEN_A,
    });
    expect(cancellation.kind).toBe("cancellation");

    const [completed] = await rows<{ ok: boolean }>(`
      select public.complete_booking_cancellation(
        '${cancellation.id}', '${TOKEN_A}', 're_cancelled', 'succeeded',
        'succeeded', 5400, 5400, '${T0}'::timestamptz
      ) as ok
    `);
    expect(completed.ok).toBe(true);

    // This represents a sweep that selected the row before cancellation and
    // did not reach its database claim until later. The claim re-reads status.
    expect(
      await claimPayout(FUTURE_BOOKING, TOKEN_B, "2026-09-17T12:00:00.000Z"),
    ).toEqual([]);

    const [booking] = await rows<{ status: string; host_paid_at: Date | null }>(`
      select status, host_paid_at from public.bookings where id = '${FUTURE_BOOKING}'
    `);
    expect(booking).toEqual({ status: "cancelled_by_host", host_paid_at: null });
  });

  it("lets a claimed refund exclude cancellation and payout", async () => {
    await insertBooking({
      id: REFUND_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, REFUND_BOOKING);

    const [refund] = await claimRefund({ requestId: REFUND_REQUEST, token: TOKEN_A });
    expect(refund.kind).toBe("refund_request");
    expect(
      await claimCancellation({ bookingId: REFUND_BOOKING, token: TOKEN_B }),
    ).toEqual([]);
    expect(
      await claimPayout(REFUND_BOOKING, TOKEN_C, "2026-09-17T12:00:00.000Z"),
    ).toEqual([]);
  });
});

describe("lease recovery and fencing", () => {
  it("reclaims only the same expired operation and fences the dead worker", async () => {
    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });

    const [first] = await claimPayout(PAYOUT_BOOKING, TOKEN_A);
    expect(first.attempts).toBe(1);
    expect(await claimPayout(PAYOUT_BOOKING, TOKEN_B, "2026-09-15T12:05:00.000Z")).toEqual([]);

    // An expired payout lease can be resumed, but it cannot be reinterpreted
    // as a different money action after a worker may already have called Stripe.
    expect(
      await claimCancellation({
        bookingId: PAYOUT_BOOKING,
        token: TOKEN_B,
        now: "2026-09-15T12:11:00.000Z",
      }),
    ).toEqual([]);

    const [resumed] = await claimPayout(
      PAYOUT_BOOKING,
      TOKEN_B,
      "2026-09-15T12:11:00.000Z",
    );
    expect(resumed.id).toBe(first.id);
    expect(resumed.attempts).toBe(2);
    expect(resumed.lease_token).toBe(TOKEN_B);

    const [stale] = await rows<{ ok: boolean }>(`
      select public.complete_booking_payout(
        '${first.id}', '${TOKEN_A}', 'tr_stale',
        '2026-09-15T12:12:00.000Z'::timestamptz
      ) as ok
    `);
    expect(stale.ok).toBe(false);

    const [winner] = await rows<{ ok: boolean }>(`
      select public.complete_booking_payout(
        '${first.id}', '${TOKEN_B}', 'tr_durable',
        '2026-09-15T12:12:00.000Z'::timestamptz
      ) as ok
    `);
    expect(winner.ok).toBe(true);

    const [truth] = await rows<{
      host_paid_at: Date | null;
      stripe_transfer_id: string | null;
      active_money_operation_id: string | null;
      state: string;
      receipt: string | null;
      lease_token: string | null;
    }>(`
      select b.host_paid_at, b.stripe_transfer_id, b.active_money_operation_id,
        o.state, o.stripe_transfer_id as receipt, o.lease_token
      from public.bookings b
      join public.booking_money_operations o on o.booking_id = b.id
      where b.id = '${PAYOUT_BOOKING}'
    `);
    expect(truth.host_paid_at).not.toBeNull();
    expect(truth).toMatchObject({
      stripe_transfer_id: "tr_durable",
      active_money_operation_id: null,
      state: "committed",
      receipt: "tr_durable",
      lease_token: null,
    });
  });

  it("never allows a second worker to change the frozen refund outcome", async () => {
    await insertBooking({
      id: REFUND_BOOKING,
      startsAt: "2026-09-14T09:00:00.000Z",
      endsAt: "2026-09-14T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, REFUND_BOOKING);

    const [first] = await claimRefund({
      requestId: REFUND_REQUEST,
      token: TOKEN_A,
      outcome: "our_fee",
    });
    expect(first.requested_outcome).toBe("our_fee");
    expect(first.expected_refund_cents).toBe(900);

    expect(
      await claimRefund({
        requestId: REFUND_REQUEST,
        token: TOKEN_B,
        outcome: "full",
        now: "2026-09-15T12:11:00.000Z",
      }),
    ).toEqual([]);

    const [same] = await claimRefund({
      requestId: REFUND_REQUEST,
      token: TOKEN_C,
      outcome: "our_fee",
      now: "2026-09-15T12:11:00.000Z",
    });
    expect(same.id).toBe(first.id);
    expect(same.requested_outcome).toBe("our_fee");
    expect(same.expected_refund_cents).toBe(900);
  });
});

describe("provider result and domain truth commit together", () => {
  it("cancels a booking with no PaymentIntent as zero charged and zero refunded", async () => {
    await insertBooking({
      id: FUTURE_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
      captured: false,
      paymentIntent: null,
    });

    const [operation] = await claimCancellation({
      bookingId: FUTURE_BOOKING,
      token: TOKEN_A,
      providerAction: "none",
      refundCents: 0,
      chargedCents: 0,
    });
    expect(operation).toMatchObject({
      provider_action: "none",
      expected_refund_cents: 0,
    });

    const [completed] = await rows<{ ok: boolean }>(`
      select public.complete_booking_cancellation(
        '${operation.id}', '${TOKEN_A}', null, null, 'not_required', 0, 0,
        '${T0}'::timestamptz
      ) as ok
    `);
    expect(completed.ok).toBe(true);

    const [truth] = await rows<{
      status: string;
      cancelled_by: string;
      refunded_cents: number | null;
      state: string;
    }>(`
      select b.status, b.cancelled_by, b.refunded_cents, o.state
      from public.bookings b
      join public.booking_money_operations o on o.booking_id = b.id
      where b.id = '${FUTURE_BOOKING}'
    `);
    expect(truth).toEqual({
      status: "cancelled_by_host",
      cancelled_by: "host",
      refunded_cents: null,
      state: "committed",
    });
  });

  it("keeps the refund-plus-charge conservation rule for a live PaymentIntent", async () => {
    await insertBooking({
      id: FUTURE_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
    });

    expect(await claimCancellation({
      bookingId: FUTURE_BOOKING,
      token: TOKEN_A,
      providerAction: "refund",
      refundCents: 5000,
      chargedCents: 0,
    })).toEqual([]);
  });

  it("keeps a pending refund request non-final, then commits every receipt atomically", async () => {
    await insertBooking({
      id: REFUND_BOOKING,
      startsAt: "2026-09-14T09:00:00.000Z",
      endsAt: "2026-09-14T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, REFUND_BOOKING);

    const [operation] = await claimRefund({
      requestId: REFUND_REQUEST,
      token: TOKEN_A,
      outcome: "our_fee",
    });

    let [request] = await rows<{
      state: string;
      outcome: string | null;
      decided_at: Date | null;
      refunded_cents: number | null;
    }>(`
      select state, outcome, decided_at, refunded_cents
      from public.refund_requests where id = '${REFUND_REQUEST}'
    `);
    let [booking] = await rows<{
      refunded_at: Date | null;
      refunded_cents: number | null;
      active_money_operation_id: string | null;
    }>(`
      select refunded_at, refunded_cents, active_money_operation_id
      from public.bookings where id = '${REFUND_BOOKING}'
    `);
    expect(request).toEqual({
      state: "awaiting_staff",
      outcome: null,
      decided_at: null,
      refunded_cents: null,
    });
    expect(booking).toEqual({
      refunded_at: null,
      refunded_cents: null,
      active_money_operation_id: operation.id,
    });

    const [pending] = await rows<{ ok: boolean }>(`
      select public.complete_refund_decision(
        '${operation.id}', '${TOKEN_A}', 're_pending', null, 'pending', 900,
        '2026-09-15T12:01:00.000Z'::timestamptz
      ) as ok
    `);
    expect(pending.ok).toBe(false);

    [request] = await rows(`
      select state, outcome, decided_at, refunded_cents
      from public.refund_requests where id = '${REFUND_REQUEST}'
    `);
    [booking] = await rows(`
      select refunded_at, refunded_cents, active_money_operation_id
      from public.bookings where id = '${REFUND_BOOKING}'
    `);
    expect(request).toEqual({
      state: "awaiting_staff",
      outcome: null,
      decided_at: null,
      refunded_cents: null,
    });
    expect(booking).toEqual({
      refunded_at: null,
      refunded_cents: null,
      active_money_operation_id: operation.id,
    });

    expect(
      await rows(`
        select * from public.claim_booking_money_operation_retries(
          '${TOKEN_B}', 25, '2026-09-15T12:04:00.000Z'::timestamptz
        )
      `),
    ).toEqual([]);
    const [retry] = await rows<Operation>(`
      select * from public.claim_booking_money_operation_retries(
        '${TOKEN_B}', 25, '2026-09-15T12:07:00.000Z'::timestamptz
      )
    `);
    expect(retry.id).toBe(operation.id);
    expect(retry.state).toBe("provider_pending");

    const [completed] = await rows<{ ok: boolean }>(`
      select public.complete_refund_decision(
        '${operation.id}', '${TOKEN_B}', 're_final', null, 'succeeded', 900,
        '2026-09-15T12:08:00.000Z'::timestamptz
      ) as ok
    `);
    expect(completed.ok).toBe(true);

    const [truth] = await rows<{
      request_state: string;
      outcome: string;
      request_refunded_cents: number;
      booking_refunded_cents: number;
      active_money_operation_id: string | null;
      operation_state: string;
      stripe_refund_id: string;
      provider_status: string;
    }>(`
      select r.state as request_state, r.outcome,
        r.refunded_cents as request_refunded_cents,
        b.refunded_cents as booking_refunded_cents,
        b.active_money_operation_id, o.state as operation_state,
        o.stripe_refund_id, o.provider_status
      from public.refund_requests r
      join public.bookings b on b.id = r.booking_id
      join public.booking_money_operations o on o.refund_request_id = r.id
      where r.id = '${REFUND_REQUEST}'
    `);
    expect(truth).toEqual({
      request_state: "approved",
      outcome: "our_fee",
      request_refunded_cents: 900,
      booking_refunded_cents: 900,
      active_money_operation_id: null,
      operation_state: "committed",
      stripe_refund_id: "re_final",
      provider_status: "succeeded",
    });
  });

  it("requires the correlated transfer reversal receipt before a paid-host full refund", async () => {
    await insertBooking({
      id: PAID_BOOKING,
      startsAt: "2026-09-14T09:00:00.000Z",
      endsAt: "2026-09-14T10:00:00.000Z",
      hostPaid: true,
    });
    await insertRefundRequest(PAID_REFUND_REQUEST, PAID_BOOKING);

    const [operation] = await claimRefund({
      requestId: PAID_REFUND_REQUEST,
      token: TOKEN_A,
      outcome: "full",
    });
    expect(operation.provider_action).toBe("reverse_and_refund");
    expect(operation.expected_reversal_cents).toBe(4500);

    const [completed] = await rows<{ ok: boolean }>(`
      select public.complete_refund_decision(
        '${operation.id}', '${TOKEN_A}', 're_full', 'trr_correlated',
        'succeeded', 5400, '2026-09-15T12:02:00.000Z'::timestamptz
      ) as ok
    `);
    expect(completed.ok).toBe(true);

    const [truth] = await rows<{
      state: string;
      source_transfer_id: string;
      stripe_refund_id: string;
      stripe_reversal_id: string;
      refunded_cents: number;
      request_state: string;
    }>(`
      select o.state, o.source_transfer_id, o.stripe_refund_id,
        o.stripe_reversal_id, b.refunded_cents, r.state as request_state
      from public.booking_money_operations o
      join public.bookings b on b.id = o.booking_id
      join public.refund_requests r on r.id = o.refund_request_id
      where o.id = '${operation.id}'
    `);
    expect(truth).toEqual({
      state: "committed",
      source_transfer_id: `tr_${PAID_BOOKING.slice(0, 8)}`,
      stripe_refund_id: "re_full",
      stripe_reversal_id: "trr_correlated",
      refunded_cents: 5400,
      request_state: "approved",
    });
  });

  it("lets a generated full-refund marker permanently block a later payout", async () => {
    await insertBooking({
      id: REFUND_BOOKING,
      startsAt: "2026-09-14T09:00:00.000Z",
      endsAt: "2026-09-14T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, REFUND_BOOKING);

    const [operation] = await claimRefund({
      requestId: REFUND_REQUEST,
      token: TOKEN_A,
      outcome: "full",
    });
    const [completed] = await rows<{ ok: boolean }>(`
      select public.complete_refund_decision(
        '${operation.id}', '${TOKEN_A}', 're_full_before_payout', null,
        'succeeded', 5400, '${T0}'::timestamptz
      ) as ok
    `);
    expect(completed.ok).toBe(true);

    const [booking] = await rows<{
      refunded_cents: number;
      host_rate_refunded: boolean;
    }>(`
      select refunded_cents, host_rate_refunded
      from public.bookings where id = '${REFUND_BOOKING}'
    `);
    expect(booking).toEqual({ refunded_cents: 5400, host_rate_refunded: true });
    expect(
      await claimPayout(REFUND_BOOKING, TOKEN_B, "2026-09-16T12:00:00.000Z"),
    ).toEqual([]);
  });

  it("retains a successful transfer receipt and projects payout drift to manual review", async () => {
    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });
    const [operation] = await claimPayout(PAYOUT_BOOKING, TOKEN_A);

    // Simulate domain drift while Stripe accepted the frozen transfer.
    await db.exec(`
      update public.bookings
      set refunded_cents = 1000, refunded_at = '${T0}'::timestamptz
      where id = '${PAYOUT_BOOKING}'
    `);
    const [completed] = await rows<{ ok: boolean }>(`
      select public.complete_booking_payout(
        '${operation.id}', '${TOKEN_A}', 'tr_already_succeeded', '${T0}'::timestamptz
      ) as ok
    `);
    expect(completed.ok).toBe(false);

    const [truth] = await rows<{
      operation_state: string;
      stripe_transfer_id: string;
      provider_status: string;
      financial_state: string;
      next_attempt_at: Date | null;
      resolved_at: Date | null;
      legacy_lease_token: string | null;
    }>(`
      select o.state as operation_state, o.stripe_transfer_id, o.provider_status,
        b.financial_resolution_state as financial_state,
        b.financial_resolution_next_attempt_at as next_attempt_at,
        b.financial_resolved_at as resolved_at,
        b.financial_resolution_lease_token as legacy_lease_token
      from public.booking_money_operations o
      join public.bookings b on b.id = o.booking_id
      where o.id = '${operation.id}'
    `);
    expect(truth).toEqual({
      operation_state: "manual_review",
      stripe_transfer_id: "tr_already_succeeded",
      provider_status: "succeeded",
      financial_state: "manual_review",
      next_attempt_at: null,
      resolved_at: null,
      legacy_lease_token: null,
    });
  });

  it("does not finalize a cancellation while its refund is pending", async () => {
    await insertBooking({
      id: FUTURE_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
    });
    const [operation] = await claimCancellation({
      bookingId: FUTURE_BOOKING,
      token: TOKEN_A,
      actor: "practitioner",
    });

    const [pending] = await rows<{ ok: boolean }>(`
      select public.complete_booking_cancellation(
        '${operation.id}', '${TOKEN_A}', 're_cancel_pending', 'pending',
        'succeeded', 5400, 5400, '2026-09-15T12:01:00.000Z'::timestamptz
      ) as ok
    `);
    expect(pending.ok).toBe(false);

    const [truth] = await rows<{
      status: string;
      cancelled_at: Date | null;
      refunded_cents: number | null;
      operation_state: string;
      active_money_operation_id: string | null;
    }>(`
      select b.status, b.cancelled_at, b.refunded_cents,
        o.state as operation_state, b.active_money_operation_id
      from public.bookings b
      join public.booking_money_operations o on o.booking_id = b.id
      where b.id = '${FUTURE_BOOKING}'
    `);
    expect(truth).toEqual({
      status: "upcoming",
      cancelled_at: null,
      refunded_cents: null,
      operation_state: "provider_pending",
      active_money_operation_id: operation.id,
    });
  });

  it("keeps a manual-review failure as the booking's permanent money lock", async () => {
    await insertBooking({
      id: REFUND_BOOKING,
      startsAt: "2026-09-14T09:00:00.000Z",
      endsAt: "2026-09-14T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, REFUND_BOOKING);
    const [operation] = await claimRefund({ requestId: REFUND_REQUEST, token: TOKEN_A });

    const [failed] = await rows<{ ok: boolean }>(`
      select public.fail_booking_money_operation(
        '${operation.id}', '${TOKEN_A}', 'Ambiguous provider response', true,
        '2026-09-15T12:01:00.000Z'::timestamptz
      ) as ok
    `);
    expect(failed.ok).toBe(true);

    const [truth] = await rows<{
      operation_state: string;
      lease_token: string | null;
      active_money_operation_id: string | null;
      request_state: string;
    }>(`
      select o.state as operation_state, o.lease_token,
        b.active_money_operation_id, r.state as request_state
      from public.booking_money_operations o
      join public.bookings b on b.id = o.booking_id
      join public.refund_requests r on r.id = o.refund_request_id
      where o.id = '${operation.id}'
    `);
    expect(truth).toEqual({
      operation_state: "manual_review",
      lease_token: null,
      active_money_operation_id: operation.id,
      request_state: "awaiting_staff",
    });
    expect(await claimPayout(REFUND_BOOKING, TOKEN_B)).toEqual([]);
    expect(
      await claimRefund({ requestId: REFUND_REQUEST, token: TOKEN_C }),
    ).toEqual([]);
  });
});

describe("legacy approved-but-unpaid refunds", () => {
  it("backfills an immutable manual-review journal and makes the request non-final", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(read(STUBS));
      for (const migration of migrations) {
        if (migration === MONEY_MIGRATION) break;
        await legacy.exec(read(migration));
      }
      await seedBase(legacy);
      await legacy.exec(`
        insert into public.bookings (
          id, space_id, practitioner_id, starts_at, ends_at, status,
          is_instant, was_pro, host_rate_cents, service_fee_cents,
          instant_fee_cents, pro_discount_cents, credit_applied_cents,
          total_cents, platform_cents, stripe_payment_intent_id, captured_at
        ) values (
          '${REFUND_BOOKING}', '${SPACE}', '${PRACTITIONER}',
          '2026-09-14T09:00:00.000Z', '2026-09-14T10:00:00.000Z',
          'completed', true, false, 4500, 900, 0, 0, 0, 5400, 900,
          'pi_legacy', '2026-09-13T12:00:00.000Z'
        );
        insert into public.refund_requests (
          id, booking_id, practitioner_id, reason, detail, state, outcome,
          decided_by, decided_at, decision_note, refunded_cents, created_at
        ) values (
          '${REFUND_REQUEST}', '${REFUND_BOOKING}', '${PRACTITIONER}',
          'no_access', 'Could not enter', 'approved', 'full', '${STAFF}',
          '2026-09-15T10:00:00.000Z', 'Legacy approval', null,
          '2026-09-15T09:00:00.000Z'
        );
      `);

      await legacy.exec(read(MONEY_MIGRATION));

      const result = await legacy.query<{
        request_state: string;
        outcome: string | null;
        decided_at: Date | null;
        operation_state: string;
        provider_action: string;
        expected_refund_cents: number;
        active_money_operation_id: string | null;
        operation_id: string;
        last_error: string;
      }>(`
        select r.state as request_state, r.outcome, r.decided_at,
          o.state as operation_state, o.provider_action,
          o.expected_refund_cents, b.active_money_operation_id,
          o.id as operation_id, o.last_error
        from public.refund_requests r
        join public.bookings b on b.id = r.booking_id
        join public.booking_money_operations o on o.refund_request_id = r.id
        where r.id = '${REFUND_REQUEST}'
      `);
      const [truth] = result.rows;
      expect(truth).toMatchObject({
        request_state: "awaiting_staff",
        outcome: null,
        decided_at: null,
        operation_state: "manual_review",
        provider_action: "refund",
        expected_refund_cents: 5400,
        active_money_operation_id: truth.operation_id,
      });
      expect(truth.last_error).toMatch(/reconcile provider state manually/i);

      const blocked = await legacy.query(`
        select * from public.claim_booking_payout(
          '${REFUND_BOOKING}', '${TOKEN_A}', '${T0}'::timestamptz
        )
      `);
      expect(blocked.rows).toEqual([]);
    } finally {
      await legacy.close();
    }
  }, 60_000);
});

describe("receipt crash-gap recovery", () => {
  it("requires final refund state and committed provider receipts at delivery time", async () => {
    const [definition] = await rows<{ source: string }>(`
      select pg_get_functiondef(
        'public.notification_delivery_is_current(text,uuid,text,text,timestamptz,boolean)'::regprocedure
      ) as source
    `);

    expect(definition.source).toMatch(/r\.state in \('approved', 'refused'\)/i);
    expect(definition.source).toMatch(/o\.state = 'committed'/i);
    expect(definition.source).toMatch(/o\.stripe_reversal_id is not null/i);
    expect(definition.source).toMatch(/p_require_settled/i);
  });

  it("lists a committed refund decision until every expected outbox claim exists", async () => {
    await insertBooking({
      id: REFUND_BOOKING,
      startsAt: "2026-09-14T09:00:00.000Z",
      endsAt: "2026-09-14T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, REFUND_BOOKING);
    const [operation] = await claimRefund({
      requestId: REFUND_REQUEST,
      token: TOKEN_A,
      outcome: "our_fee",
    });
    await rows(`
      select public.complete_refund_decision(
        '${operation.id}', '${TOKEN_A}', 're_gap', null, 'succeeded', 900,
        '${T0}'::timestamptz
      )
    `);

    let gaps = await rows<{ id: string }>(`
      select * from public.list_refund_decision_notification_gaps(
        '${T0}'::timestamptz - interval '1 hour', 100
      )
    `);
    expect(gaps).toEqual([{ id: REFUND_REQUEST }]);

    await db.exec(`
      insert into public.notifications (
        user_id, booking_id, kind, channel, dedupe_key, destination,
        message_snapshot, attempts, next_attempt_at
      ) values (
        '${PRACTITIONER}', '${REFUND_BOOKING}', 'refund_decided', 'email',
        'refund_decided:${REFUND_REQUEST}:email', 'money-practitioner@example.com',
        '{"version":1,"message":{"subject":"Decision","body":"Complete","sms":null}}',
        0, '${T0}'::timestamptz
      )
    `);
    gaps = await rows(`
      select * from public.list_refund_decision_notification_gaps(
        '${T0}'::timestamptz - interval '1 hour', 100
      )
    `);
    expect(gaps).toEqual([]);
  });
});

describe("PR1 financial-resolution compatibility", () => {
  it("fails all claims closed while the legacy resolver owns the booking", async () => {
    await db.exec(`
      alter table public.bookings
        add column if not exists financial_resolution_state text not null default 'not_required',
        add column if not exists financial_resolution_next_attempt_at timestamptz,
        add column if not exists financial_resolution_last_error text,
        add column if not exists financial_resolved_at timestamptz,
        add column if not exists financial_resolution_lease_token uuid,
        add column if not exists financial_resolution_lease_until timestamptz;
    `);
    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });
    await insertBooking({
      id: FUTURE_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
    });
    await insertBooking({
      id: REFUND_BOOKING,
      startsAt: "2026-09-14T09:00:00.000Z",
      endsAt: "2026-09-14T10:00:00.000Z",
    });
    await insertRefundRequest(REFUND_REQUEST, REFUND_BOOKING);
    await db.exec(`
      update public.bookings
      set financial_resolution_state = 'pending',
          financial_resolution_next_attempt_at = '${T0}'::timestamptz,
          financial_resolved_at = null,
          financial_resolution_lease_token = null,
          financial_resolution_lease_until = null
      where id in ('${PAYOUT_BOOKING}', '${REFUND_BOOKING}');
      update public.bookings
      set financial_resolution_state = 'manual_review',
          financial_resolution_next_attempt_at = null,
          financial_resolved_at = null,
          financial_resolution_lease_token = null,
          financial_resolution_lease_until = null
      where id = '${FUTURE_BOOKING}';
    `);

    expect(await claimPayout(PAYOUT_BOOKING, TOKEN_A)).toEqual([]);
    expect(await claimRefund({ requestId: REFUND_REQUEST, token: TOKEN_B })).toEqual([]);
    expect(await claimCancellation({ bookingId: FUTURE_BOOKING, token: TOKEN_C })).toEqual([]);
  });

  it("projects a committed cancellation to the resolved legacy receipt gate", async () => {
    await insertBooking({
      id: FUTURE_BOOKING,
      startsAt: "2026-09-16T09:00:00.000Z",
      endsAt: "2026-09-16T10:00:00.000Z",
    });
    const [operation] = await claimCancellation({
      bookingId: FUTURE_BOOKING,
      token: TOKEN_A,
    });
    const [completion] = await rows<{ ok: boolean }>(`
      select public.complete_booking_cancellation(
        '${operation.id}', '${TOKEN_A}', 're_resolved', 'succeeded',
        'succeeded', 5400, 5400, '${T0}'::timestamptz
      ) as ok
    `);
    expect(completion.ok).toBe(true);

    const [booking] = await rows<{
      state: string;
      resolved_at: Date | null;
    }>(`
      select financial_resolution_state as state,
        financial_resolved_at as resolved_at
      from public.bookings where id = '${FUTURE_BOOKING}'
    `);
    expect(booking.state).toBe("resolved");
    expect(booking.resolved_at).not.toBeNull();
  });

  it("projects a non-cancellation journal conflict to the legacy manual-review queue", async () => {
    await insertBooking({
      id: PAYOUT_BOOKING,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
    });
    const [operation] = await claimPayout(PAYOUT_BOOKING, TOKEN_A);
    const [failed] = await rows<{ ok: boolean }>(`
      select public.fail_booking_money_operation(
        '${operation.id}', '${TOKEN_A}', 'Provider records conflict', true,
        '${T0}'::timestamptz
      ) as ok
    `);
    expect(failed.ok).toBe(true);

    const [booking] = await rows<{ state: string; last_error: string }>(`
      select financial_resolution_state as state,
        financial_resolution_last_error as last_error
      from public.bookings where id = '${PAYOUT_BOOKING}'
    `);
    expect(booking).toEqual({
      state: "manual_review",
      last_error: "Money journal requires manual review",
    });
  });
});
