import "server-only";

import { type CityRow, type CityTypeRow, indexablePaths, pickRouteListing } from "./directory";
import { idFromSlug, listingPath, uuidPrefixRange } from "./listing-url";
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
  const [cities, types, listings] = await Promise.all([
    citiesWithSpaces(),
    cityTypesWithSpaces(),
    listingPaths(),
  ]);
  return [...indexablePaths(cities, types), ...listings];
}


/**
 * One room, with everything a public page may show.
 *
 * Read from spaces_public, which only ever contains active listings — so a
 * delisted room resolves to nothing here and its page 404s, without this
 * having to remember to ask about status.
 */
export interface DirectoryListing extends DirectorySpace {
  roomSetup: string;
  amenities: string[];
  requirements: string[];
  houseRules: string;
  addressLine: string | null;
  floorAreaSqft: number | null;
  bufferMinutes: number;
  photos: string[];
  reviewCount: number;
  averageRating: number | null;
}

const LISTING_COLUMNS =
  "id, name, category, hourly_rate_cents, capacity, city, state, area, description, " +
  "suitable_for, room_setup, amenities, requirements, house_rules, address_line, " +
  "floor_area_sqft, buffer_minutes";

/**
 * The room behind a slug, found by the id on the end of it, in the town the
 * address names.
 *
 * Only the id is trusted for *which* room. The words in front are the host's
 * name for it at the time the link was made and are allowed to have changed —
 * that is the whole reason the id is there. The town, though, is checked: the
 * URL carries only eight characters of the id, which is not guaranteed unique,
 * so the town is what tells a rare prefix collision apart and what keeps an
 * address from resolving to a room in a different town than it claims.
 */
export async function listingBySlug(
  slug: string,
  route: { state: string; city: string },
): Promise<DirectoryListing | null> {
  if (!isSupabaseConfigured()) return null;

  const short = idFromSlug(slug);
  if (!short) return null;

  // The eight characters in the URL are the id's first group. `like` on a uuid
  // is not an operator (it throws, 42883); the range those characters bound is,
  // and the primary-key index answers it — see uuidPrefixRange.
  const range = uuidPrefixRange(short);
  if (!range) return null;

  const db = supabasePublic();

  const { data, error } = await db
    .from("spaces_public")
    .select(LISTING_COLUMNS)
    .gte("id", range.min)
    .lte("id", range.max)
    // A handful is more than a prefix collision has ever produced, and enough
    // to tell a real one from a unique match without reading the whole table.
    .limit(5);

  if (error || !data || data.length === 0) return null;

  // spaces_public is active-only, so a delisted room was never a candidate.
  // Among the id-prefix matches, the one whose town is the town the address
  // names — or nothing, on a same-town tie, rather than a guess. See
  // pickRouteListing.
  const chosen = pickRouteListing(
    data as unknown as (Record<string, unknown> & { state: string | null; city: string | null })[],
    route,
  );
  if (!chosen) return null;

  const row = chosen;
  const id = String(row.id);

  const [{ data: media }, { data: rating }] = await Promise.all([
    db.from("space_media_public").select("storage_path, kind, position").eq("space_id", id).order("position"),
    db.from("space_ratings").select("review_count, average_rating").eq("space_id", id).maybeSingle(),
  ]);

  return {
    id,
    name: String(row.name ?? ""),
    category: String(row.category ?? ""),
    hourlyRateCents: Number(row.hourly_rate_cents ?? 0),
    capacity: Number(row.capacity ?? 0),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    area: (row.area as string | null) ?? null,
    description: String(row.description ?? ""),
    suitableFor: Array.isArray(row.suitable_for) ? (row.suitable_for as string[]) : [],
    roomSetup: String(row.room_setup ?? "private_room"),
    amenities: Array.isArray(row.amenities) ? (row.amenities as string[]) : [],
    requirements: Array.isArray(row.requirements) ? (row.requirements as string[]) : [],
    houseRules: String(row.house_rules ?? ""),
    addressLine: (row.address_line as string | null) ?? null,
    floorAreaSqft: row.floor_area_sqft === null ? null : Number(row.floor_area_sqft),
    bufferMinutes: Number(row.buffer_minutes ?? 0),
    // Photographs only. A video needs a player and a poster frame, and a page
    // that has to run JavaScript to show its first picture is a page a crawler
    // reads as having none.
    photos: ((media ?? []) as { storage_path: string; kind: string }[])
      .filter((item) => item.kind === "image")
      .map((item) => db.storage.from("space-media").getPublicUrl(item.storage_path).data.publicUrl),
    reviewCount: Number((rating as { review_count?: number } | null)?.review_count ?? 0),
    averageRating:
      (rating as { average_rating?: number } | null)?.average_rating != null
        ? Number((rating as { average_rating: number }).average_rating)
        : null,
  };
}

/**
 * Every listing that has a page, for the sitemap.
 *
 * Not gated on a threshold the way the town pages are. One room is a complete
 * answer to "what is this room" — the thin-page problem is a page that
 * promises a list and delivers nothing, and a listing promises one room.
 */
export async function listingPaths(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabasePublic()
    .from("spaces_public")
    .select("id, name, city, state");

  if (error || !data) return [];

  return (data as { id: string; name: string; city: string | null; state: string | null }[])
    .flatMap((row) => {
      const path = listingPath(row);
      return path ? [path] : [];
    })
    .sort();
}
