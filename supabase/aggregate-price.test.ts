import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Aggregate price is withheld for small groups (migration 0064).
 *
 * The public inventory views may say a town has rooms and, once there are
 * enough of them, roughly what they cost. But a min/median/max over one or two
 * rooms is an individual host's price, not a market's — so below three active
 * rooms the three price columns come back NULL at the view itself, not merely
 * hidden in the page. This proves that boundary directly, as a reader of the
 * views, so it holds for anyone querying PostgREST and not only the rendered
 * page. The count is never withheld.
 */

const migrationsDir = join(import.meta.dirname, "migrations");
const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

/** N active listings in one town, one category, one use, at the given rates. */
function seed(city: string, category: string, use: string, rates: number[]): string {
  return rates
    .map(
      (rate, i) => `(
        gen_random_uuid(), '${HOST}', '${city} ${i}', '${category}', ${rate}, 3, 'keypad',
        'Instructions', '${i} ${city} Street', 'active', 'space/x/lease.pdf', now(),
        'verified', now(), '${city}', 'CA', array['${use}']::text[]
      )`,
    )
    .join(",\n");
}

beforeAll(async () => {
  db = new PGlite();
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) await db.exec(readFileSync(join(migrationsDir, file), "utf8"));

  await db.exec(`
    insert into auth.users (id, email) values ('${HOST}', 'agg-host@example.com');
    insert into profiles (id, display_name) values ('${HOST}', 'Aggregate Host');

    insert into spaces (
      id, host_id, name, category, hourly_rate_cents, capacity, access_type,
      entry_instructions, address_line, status, sublease_doc_path, legal_ack_at,
      sublease_doc_state, sublease_doc_reviewed_at, city, state, suitable_for
    ) values
      ${seed("Onehaven", "physical", "movement-studio", [4000])},
      ${seed("Twofield", "spirit", "meditation-room", [3000, 5000])},
      ${seed("Trioton", "physical", "movement-studio", [3000, 4000, 5000])};
  `);
});

afterAll(async () => {
  await db?.close();
});

interface AggRow {
  space_count: number;
  min_cents: number | null;
  max_cents: number | null;
  median_cents: number | null;
}

function expectSuppressed(row: AggRow, expectedCount: number) {
  expect(row.space_count).toBe(expectedCount);
  expect(row.min_cents).toBeNull();
  expect(row.max_cents).toBeNull();
  expect(row.median_cents).toBeNull();
}

function expectPriced(row: AggRow, expectedCount: number) {
  expect(row.space_count).toBe(expectedCount);
  expect(row.min_cents).toBe(3000);
  expect(row.max_cents).toBe(5000);
  expect(row.median_cents).not.toBeNull();
}

describe("city_inventory withholds a small-group price", () => {
  it("keeps the count but nulls the price for 1 and 2 rooms, prices 3", async () => {
    const towns = await rows<AggRow & { city: string }>(
      `select city, space_count, min_cents, max_cents, median_cents from city_inventory`,
    );
    const by = new Map(towns.map((t) => [t.city, t]));

    expectSuppressed(by.get("Onehaven")!, 1);
    expectSuppressed(by.get("Twofield")!, 2);
    expectPriced(by.get("Trioton")!, 3);
  });
});

describe("city_category_inventory withholds a small-group price", () => {
  it("applies the same rule per category", async () => {
    const groups = await rows<AggRow & { city: string; category: string }>(
      `select city, category, space_count, min_cents, max_cents, median_cents
       from city_category_inventory`,
    );
    const by = new Map(groups.map((g) => [`${g.city}/${g.category}`, g]));

    expectSuppressed(by.get("Onehaven/physical")!, 1);
    expectSuppressed(by.get("Twofield/spirit")!, 2);
    expectPriced(by.get("Trioton/physical")!, 3);
  });
});

describe("city_type_inventory withholds a small-group price", () => {
  it("applies the same rule per use", async () => {
    const groups = await rows<AggRow & { city: string; space_type: string }>(
      `select city, space_type, space_count, min_cents, max_cents, median_cents
       from city_type_inventory`,
    );
    const by = new Map(groups.map((g) => [`${g.city}/${g.space_type}`, g]));

    expectSuppressed(by.get("Onehaven/movement-studio")!, 1);
    expectSuppressed(by.get("Twofield/meditation-room")!, 2);
    expectPriced(by.get("Trioton/movement-studio")!, 3);
  });
});
