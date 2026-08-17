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
  min_cents: number;
  max_cents: number;
  median_cents: number;
}

interface CityTypeInventoryRow extends CityInventoryRow {
  space_type: string;
}

function toCityRow(row: CityInventoryRow): CityRow {
  return {
    state: row.state,
    city: row.city,
    spaceCount: Number(row.space_count),
    minCents: Number(row.min_cents),
    maxCents: Number(row.max_cents),
    medianCents: Number(row.median_cents),
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
 * The rooms on a town's page.
 *
 * `spaces_public` only ever contains active listings, so there is no status to
 * filter — and the street address it carries is deliberate: every listing here
 * is a retail studio whose address is already on its own website. What stays
 * private is how to get in, which is not in this view at all.
 */
export interface DirectorySpace {
  id: string;
  name: string;
  category: string;
  hourlyRateCents: number;
  capacity: number;
  city: string;
  state: string;
  area: string | null;
  description: string;
  suitableFor: string[];
}

export async function spacesIn(
  state: string,
  city: string,
  spaceType?: string,
): Promise<DirectorySpace[]> {
  if (!isSupabaseConfigured()) return [];

  let query = supabasePublic()
    .from("spaces_public")
    .select(
      "id, name, category, hourly_rate_cents, capacity, city, state, area, description, suitable_for",
    )
    .eq("state", state)
    .eq("city", city)
    // Cheapest first. A page answering "what does a room here cost" should
    // open on the answer somebody can afford, not on the most expensive room.
    .order("hourly_rate_cents", { ascending: true });

  if (spaceType) query = query.contains("suitable_for", [spaceType]);

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    category: String(row.category ?? ""),
    hourlyRateCents: Number(row.hourly_rate_cents ?? 0),
    capacity: Number(row.capacity ?? 0),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    area: (row.area as string | null) ?? null,
    description: String(row.description ?? ""),
    suitableFor: Array.isArray(row.suitable_for) ? (row.suitable_for as string[]) : [],
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
 */
export async function generatedPaths(): Promise<string[]> {
  const [cities, types] = await Promise.all([citiesWithSpaces(), cityTypesWithSpaces()]);
  return indexablePaths(cities, types);
}
