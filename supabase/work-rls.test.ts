import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Work RLS and the atomic confirm, exercised as real users.
 *
 * PGlite connects as superuser (bypasses RLS), so every end-user assertion runs
 * inside `asUser()`, which drops into the `authenticated` role with a JWT
 * subject — the only way a policy assertion means anything. The service-role
 * work (confirm_work_interest) runs as superuser, which is what the server does.
 */
const migrationsDir = join(import.meta.dirname, "migrations");
const read = (file: string) => readFileSync(join(migrationsDir, file), "utf8");

const HOST = "11111111-1111-1111-1111-111111111111";
const RIVAL = "22222222-2222-2222-2222-222222222222";
const P1 = "33333333-3333-3333-3333-333333333333";
const P2 = "44444444-4444-4444-4444-444444444444";
const REQ = "55555555-5555-5555-5555-555555555555";
const I1 = "66666666-6666-4666-8666-666666666666";
const I2 = "77777777-7777-4777-8777-777777777777";

let db: PGlite;

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
    return (await tx.query<T>(sql)).rows;
  }) as Promise<T[]>;
}
const asUser = <T = Record<string, unknown>>(userId: string, sql: string) =>
  runAs<T>("authenticated", userId, sql);
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

async function seed(): Promise<void> {
  await db.exec(`truncate table work_interest, work_requests, work_availability,
    work_preferences, class_templates, profiles, auth.users cascade;`);
  await db.exec(`
    insert into auth.users (id) values ('${HOST}'),('${RIVAL}'),('${P1}'),('${P2}');
    insert into profiles (id, account_type, display_name) values
      ('${HOST}','host','Studio'),
      ('${RIVAL}','host','Rival Studio'),
      ('${P1}','practitioner','Sarah Miller'),
      ('${P2}','practitioner','Alex Doe');
    insert into work_requests (id, host_id, title, starts_at, ends_at, time_zone, pay_cents, state)
      values ('${REQ}','${HOST}','Reformer Flow',
        now() + interval '2 days', now() + interval '2 days 1 hour',
        'America/Los_Angeles', 6000, 'open');
    insert into work_interest (id, request_id, practitioner_id, state) values
      ('${I1}','${REQ}','${P1}','interested'),
      ('${I2}','${REQ}','${P2}','interested');
  `);
}

beforeAll(async () => {
  db = new PGlite();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) await db.exec(read(file));
}, 60_000);

beforeEach(seed);
afterAll(async () => {
  await db?.close();
});

describe("the harness really drops privileges", () => {
  it("runs as authenticated with the impersonated subject", async () => {
    const [role] = await asUser<{ who: string; sub: string }>(
      P1,
      `select current_user::text as who, auth.uid()::text as sub`,
    );
    expect(role.who).toBe("authenticated");
    expect(role.sub).toBe(P1);
  });
});

describe("work_preferences — owner only", () => {
  it("a practitioner can create and read their own row", async () => {
    await asUser(P1, `insert into work_preferences (practitioner_id) values ('${P1}')`);
    const mine = await asUser(P1, `select practitioner_id from work_preferences`);
    expect(mine).toHaveLength(1);
  });

  it("cannot create a row for someone else", async () => {
    await expect(
      asUser(P1, `insert into work_preferences (practitioner_id) values ('${P2}')`),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a host cannot opt in — the insert gate requires a practitioner account", async () => {
    await expect(
      asUser(HOST, `insert into work_preferences (practitioner_id) values ('${HOST}')`),
    ).rejects.toThrow(/row-level security/i);
  });

  it("one practitioner cannot read another's preferences", async () => {
    await asUser(P1, `insert into work_preferences (practitioner_id) values ('${P1}')`);
    expect(await asUser(P2, `select * from work_preferences`)).toEqual([]);
  });
});

describe("class_templates — host only", () => {
  it("a practitioner cannot create a template", async () => {
    await expect(
      asUser(
        P1,
        `insert into class_templates (host_id, title) values ('${P1}','Flow')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a host creates and reads only their own", async () => {
    await asUser(HOST, `insert into class_templates (host_id, title) values ('${HOST}','Flow')`);
    await asUser(RIVAL, `insert into class_templates (host_id, title) values ('${RIVAL}','Barre')`);
    const mine = await asUser<{ title: string }>(HOST, `select title from class_templates`);
    expect(mine.map((r) => r.title)).toEqual(["Flow"]);
  });
});

describe("work_requests — host reads own, nobody writes from the browser", () => {
  it("the owning host reads it; a practitioner and a rival host do not", async () => {
    expect(await asUser(HOST, `select id from work_requests`)).toHaveLength(1);
    expect(await asUser(P1, `select id from work_requests`)).toEqual([]);
    expect(await asUser(RIVAL, `select id from work_requests`)).toEqual([]);
  });

  it("no client can insert a request (server-only)", async () => {
    await expect(
      asUser(
        HOST,
        `insert into work_requests (host_id, title, starts_at, ends_at, time_zone, pay_cents)
         values ('${HOST}','x', now()+interval '1 day', now()+interval '1 day 1 hour','America/Los_Angeles',100)`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("work_interest — scoped through the request, never by practitioner id", () => {
  it("a practitioner sees only their own interest", async () => {
    expect(await asUser(P1, `select id from work_interest`)).toHaveLength(1);
    const [row] = await asUser<{ id: string }>(P1, `select id from work_interest`);
    expect(row.id).toBe(I1);
  });

  it("the owning host sees every interest on their request; a rival sees none", async () => {
    expect(await asUser(HOST, `select id from work_interest where request_id = '${REQ}'`)).toHaveLength(2);
    expect(await asUser(RIVAL, `select id from work_interest`)).toEqual([]);
  });

  it("no client can insert interest (server-only)", async () => {
    await expect(
      asUser(
        P1,
        `insert into work_interest (request_id, practitioner_id) values ('${REQ}','${P1}')`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("confirm_work_interest — atomic single fill", () => {
  it("confirms exactly one, declines the rest, and fills the request", async () => {
    const [{ confirm_work_interest: result }] = await rows<{ confirm_work_interest: string | null }>(
      `select confirm_work_interest('${REQ}','${I1}')`,
    );
    expect(result).toBe(I1);

    const interest = await rows<{ id: string; state: string }>(
      `select id, state from work_interest order by id`,
    );
    const byId = Object.fromEntries(interest.map((r) => [r.id, r.state]));
    expect(byId[I1]).toBe("confirmed");
    expect(byId[I2]).toBe("declined");

    const [req] = await rows<{ state: string; filled_interest_id: string }>(
      `select state, filled_interest_id from work_requests where id = '${REQ}'`,
    );
    expect(req.state).toBe("filled");
    expect(req.filled_interest_id).toBe(I1);
  });

  it("a second confirm changes nothing — the first winner stands", async () => {
    await rows(`select confirm_work_interest('${REQ}','${I1}')`);
    const [{ confirm_work_interest: second }] = await rows<{ confirm_work_interest: string | null }>(
      `select confirm_work_interest('${REQ}','${I2}')`,
    );
    expect(second).toBeNull();
    const [req] = await rows<{ filled_interest_id: string }>(
      `select filled_interest_id from work_requests where id = '${REQ}'`,
    );
    expect(req.filled_interest_id).toBe(I1);
  });

  it("cannot fill a cancelled request", async () => {
    await db.exec(`update work_requests set state='cancelled', cancelled_at=now() where id='${REQ}'`);
    const [{ confirm_work_interest: result }] = await rows<{ confirm_work_interest: string | null }>(
      `select confirm_work_interest('${REQ}','${I1}')`,
    );
    expect(result).toBeNull();
  });

  it("cannot fill a request whose start has passed (effectively expired)", async () => {
    await db.exec(
      `update work_requests set starts_at = now() - interval '1 hour',
        ends_at = now() - interval '10 minutes' where id='${REQ}'`,
    );
    const [{ confirm_work_interest: result }] = await rows<{ confirm_work_interest: string | null }>(
      `select confirm_work_interest('${REQ}','${I1}')`,
    );
    expect(result).toBeNull();
  });

  it("the schema itself refuses a second confirmed interest on one request", async () => {
    await rows(`select confirm_work_interest('${REQ}','${I1}')`);
    // Force a second confirmed row past the function — the partial unique index
    // is the backstop and must reject it.
    await expect(
      db.exec(`update work_interest set state='confirmed' where id='${I2}'`),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});
