import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "migrations");
const STUBS = "0000_supabase_stubs.sql";
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && file !== STUBS)
  .sort();
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const USER = "51000000-0000-4000-8000-000000000001";
const SECOND_USER = "51000000-0000-4000-8000-000000000002";
const UNSUBSCRIBE = "52000000-0000-4000-8000-000000000001";
const NOW = "2026-09-16T12:00:00.000Z";
let db: PGlite;

async function asRole<T = Record<string, unknown>>(
  role: "authenticated" | "service_role",
  sql: string,
  userId = USER,
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (role === "authenticated") {
      await tx.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
    }
    return (await tx.query<T>(sql)).rows;
  });
}

async function enqueue(userId: string, suffix: string): Promise<boolean> {
  const correlation = createHash("sha256")
    .update(`correlation:${userId}:${suffix}`, "utf8")
    .digest("hex");
  const [row] = await asRole<{ inserted: boolean }>(
    "service_role",
    `select enqueue_marketing_email(
       '${userId}', 'rebooking', 1, 'marketing:test:${userId}:${suffix}',
       'Keep your next booking simple', 'Plain body', '<p>HTML body</p>',
       '${correlation}',
       '${NOW}', '2026-09-23T12:00:00.000Z', '${NOW}'
     ) as inserted`,
  );
  return row.inserted;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read(STUBS));
  for (const migration of migrations) await db.exec(read(migration));
  await db.exec(`
    insert into auth.users(id, email) values
      ('${USER}', 'marketing-one@example.com'),
      ('${SECOND_USER}', 'marketing-two@example.com');
    insert into profiles(id, display_name, marketing_unsubscribe_token) values
      ('${USER}', 'One', '${UNSUBSCRIBE}'),
      ('${SECOND_USER}', 'Two', '52000000-0000-4000-8000-000000000002');
  `);
  await asRole("authenticated", `update profiles set notify_offers = true where id = '${USER}'`);
  await asRole(
    "authenticated",
    `update profiles set notify_offers = true where id = '${SECOND_USER}'`,
    SECOND_USER,
  );
}, 60_000);

afterAll(async () => db?.close());

describe("isolated marketing outbox", () => {
  it("atomically deduplicates and frequency-caps consented lifecycle mail", async () => {
    await expect(enqueue(USER, "first")).resolves.toBe(true);
    await expect(enqueue(USER, "first")).resolves.toBe(false);
    await expect(enqueue(USER, "second-in-one-day")).resolves.toBe(false);
  });

  it("is unreadable to the signed-in recipient", async () => {
    await expect(
      asRole("authenticated", "select subject from marketing_outbox"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("rechecks opt-out at claim time and destroys the pending envelope", async () => {
    await expect(enqueue(SECOND_USER, "withdrawn")).resolves.toBe(true);
    await asRole(
      "authenticated",
      `update profiles set notify_offers = false where id = '${SECOND_USER}'`,
      SECOND_USER,
    );

    const claimed = await asRole(
      "service_role",
      `select * from claim_marketing_email_batch(
        '53000000-0000-4000-8000-000000000001', 25, '${NOW}'
      )`,
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ user_id: USER, unsubscribe_token: UNSUBSCRIBE });

    const [withdrawn] = (await db.query<{
      state: string;
      subject: string | null;
      html_body: string | null;
    }>(`
      select state, subject, html_body from marketing_outbox
      where user_id = '${SECOND_USER}'
    `)).rows;
    expect(withdrawn).toEqual({ state: "suppressed", subject: null, html_body: null });
  });

  it("reconciles a complaint, erases content and revokes marketing only", async () => {
    const [claimed] = (await db.query<{
      id: string;
      lease_token: string;
      provider_correlation_id: string;
    }>(`
      select id::text, lease_token::text, provider_correlation_id
      from marketing_outbox where user_id = '${USER}' and state = 'sending'
    `)).rows;

    const [accepted] = await asRole<{ recorded: boolean }>(
      "service_role",
      `select record_marketing_email_acceptance(
        '${claimed.id}', 'email_marketing_test', '${NOW}', '${claimed.lease_token}'
      ) as recorded`,
    );
    expect(accepted.recorded).toBe(true);

    await asRole(
      "service_role",
      `select apply_resend_delivery_event(
        'email_marketing_test', '${claimed.provider_correlation_id}',
        'email.complained', '2026-09-16T12:01:00.000Z'
      )`,
    );

    const [result] = (await db.query<{
      state: string;
      subject: string | null;
      notify_offers: boolean;
      marketing_unsubscribe_reason: string;
    }>(`
      select m.state, m.subject, p.notify_offers, p.marketing_unsubscribe_reason
      from marketing_outbox m join profiles p on p.id = m.user_id
      where m.id = '${claimed.id}'
    `)).rows;
    expect(result).toEqual({
      state: "suppressed",
      subject: null,
      notify_offers: false,
      marketing_unsubscribe_reason: "provider_complaint",
    });
  });

  it("verifies the scheduler bearer by digest without exposing the digest table", async () => {
    const hash = "f".repeat(64);
    await db.exec(`
      insert into private.scheduler_bearer_hashes(name, token_sha256)
      values ('notification_recovery', '${hash}')
    `);
    const [valid] = await asRole<{ valid: boolean }>(
      "service_role",
      `select verify_notification_scheduler_token('${hash}') as valid`,
    );
    expect(valid.valid).toBe(true);
    await expect(
      asRole("service_role", "select * from private.scheduler_bearer_hashes"),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("authenticated", `select verify_notification_scheduler_token('${hash}')`),
    ).rejects.toThrow(/permission denied/i);
  });
});
