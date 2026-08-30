import "server-only";

import { type CityRow, type CityTypeRow, indexablePaths } from "./directory";
import { isSupabaseConfigured } from "./supabase/env";
import { supabasePublic } from "./supabase/server";

/**
 * The inventory the generated pages are built from.
 *
 * Two views, both computed in the database and both readable by `anon` — see
 * 0043. Counting here instead would mean every page fetching every listing and
 * grouping them in JavaScript, and it would mean the sitemap and the pages
 * counting separately, which is the drift the whole indexing rule exists to
 * avoid.
 *
 * Nothing here throws. A marketing site that returns 500 because a database is
 * unreachable is worse than one whose city pages are briefly missing: the
 * pages come back, and a crawler that met a 500 does not necessarily come
 * back soon. Failure means "no towns", which every caller already handles
 * because it is also the state the site is in today.
 */

interface CityInventoryRow {
  state: string;
  city: string;
  space_count: number;
  // NULL below three active rooms — the aggregate views withhold a small-group
  // price so an individual listing's rate is never exposed (migration 0064).
  min_cents: number | null;
  max_cents: number | null;
  median_cents: number | null;
}

interface CityTypeInventoryRow extends CityInventoryRow {
  space_type: string;
}

function toCityRow(row: CityInventoryRow): CityRow {
  // Null passes straight through — a small-group price the view withheld (0064)
  // stays withheld rather than becoming a misleading $0.00.
  const cents = (value: number | null): number | null => (value === null ? null : Number(value));
  return {
    state: row.state,
    city: row.city,
    spaceCount: Number(row.space_count),
    minCents: cents(row.min_cents),
    maxCents: cents(row.max_cents),
    medianCents: cents(row.median_cents),
  };
}

export async function citiesWithSpaces(): Promise<CityRow[]> {
  // Not configured is a normal state in development and during a build that
  // has no secrets. It is not an error, and it is certainly not a 500.
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabasePublic()
    .from("city_inventory")
    .select("state, city, space_count, min_cents, max_cents, median_cents");

  if (error || !data) return [];
  return (data as CityInventoryRow[]).map(toCityRow);
}

/**
 * The towns with live inventory in one category — what a "Explore by space"
 * card resolves to.
 *
 * The marketing cards carry a space-type slug; the caller has already turned
 * that into a category (a SpaceType knows its category). This reads the
 * aggregate `city_category_inventory` view (0064) rather than the per-listing
 * `spaces_public`, so the public directory never touches an individual listing:
 * a room carries one category, so the count is exact. Anonymous callers can
 * read this view; `spaces_public` is now closed to them. Returns empty on any
 * failure, the same "no towns" every caller already handles.
 */
export async function citiesWithCategory(category: string): Promise<CityRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabasePublic()
    .from("city_category_inventory")
    .select("state, city, space_count, min_cents, max_cents, median_cents")
    .eq("category", category);

  if (error || !data) return [];
  return (data as CityInventoryRow[]).map(toCityRow);
}

export async function cityTypesWithSpaces(): Promise<CityTypeRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabasePublic()
    .from("city_type_inventory")
    .select("state, city, space_type, space_count, min_cents, max_cents, median_cents");

  if (error || !data) return [];
  return (data as CityTypeInventoryRow[]).map((row) => ({
    ...toCityRow(row),
    spaceType: row.space_type,
  }));
}

/**
 * The generated addresses, which depend on what is actually listed.
 *
 * Kept apart from the fixed paths above because they are a different kind of
 * thing: those are pages that exist because somebody wrote them, these are
 * pages that exist because a town has rooms in it. The split is also how the
 * sitemap can be read in Search Console as two questions — is the writing
 * working, and is the inventory working — rather than one blurred one.
 *
 * The decision about which of them belong here is not made here. It is
 * `indexablePaths`, the same function the pages' own robots tags and the
 * links between them call, so a page cannot be advertised in one place and
 * hidden in another.
 *
 * Today this is empty, and that is the engine working rather than failing.
 *
 * Individual listing URLs are no longer among them (0064). A room's own page is
 * a redirect into the app now, not a public document, so advertising it to a
 * crawler would be pointing search at a bounce. Only the aggregate town and
 * town-and-use pages — which stay public — are offered here.
 */
export async function generatedPaths(): Promise<string[]> {
  const [cities, types] = await Promise.all([citiesWithSpaces(), cityTypesWithSpaces()]);
  return indexablePaths(cities, types);
}
