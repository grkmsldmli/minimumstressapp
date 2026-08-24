import { SPACE_TYPES, spaceTypeBySlug } from "./space-types";

/**
 * Which generated pages are worth showing a search engine, decided once.
 *
 * The pages themselves are cheap: a town and a use are two columns, and a
 * query over them can produce a thousand addresses. That is exactly the danger.
 * A thousand near-empty pages teach a search engine that this site is mostly
 * nothing, and it applies that judgement to the pages that are not — which is
 * how programmatic SEO usually fails, and why it has the reputation it has.
 *
 * So there is a threshold, and everything reads the same one. The sitemap, the
 * page's own robots tag and the internal links between pages all call the
 * functions below. Three separate decisions would drift, and the way that
 * shows up is a sitemap advertising pages that tell the crawler to go away —
 * which costs more trust than the pages were ever going to earn.
 *
 * Today every one of these answers "no", because there are no listings. That
 * is the engine working, not the engine missing.
 */

/**
 * How many bookable rooms a page needs before it is worth indexing.
 *
 * Three rather than one. A page with a single room on it is not useless to a
 * person who lands on it — it still shows them the room — but it is not an
 * answer to "pilates studios in San Mateo", and a search engine that is shown
 * a hundred of those learns the wrong thing about the rest of the site. Below
 * this the page still exists and still renders; it is simply not advertised.
 */
export const MIN_LISTINGS_TO_INDEX = 3;

/**
 * How many live rooms a town needs before a *person* is shown it. One.
 *
 * The other end of the same scale MIN_LISTINGS_TO_INDEX sits on, and the two
 * are deliberately different numbers because they answer to different
 * audiences. A single real room is inventory somebody can book right now;
 * hiding it from the person who came looking, because a search engine would not
 * yet index a page with one room on it, is confusing the two. Discovery starts
 * at the first live room; indexing keeps its higher, separate bar below.
 */
export const MIN_LISTINGS_TO_SHOW = 1;

export interface CityRow {
  state: string;
  city: string;
  spaceCount: number;
  minCents: number;
  maxCents: number;
  medianCents: number;
}

export interface CityTypeRow extends CityRow {
  spaceType: string;
}

/**
 * The town as it appears in a URL.
 *
 * Derived rather than stored, so a town renamed by the geocoder cannot leave a
 * slug column pointing at nothing. It is lossy on purpose — "St. Helena" and
 * "St Helena" both become `st-helena`, which is what somebody typing either
 * would expect to reach.
 */
export function citySlug(city: string): string {
  return city
    .toLowerCase()
    .normalize("NFD")
    // Strip accents rather than percent-encode them: "Cañada" in a URL should
    // read as canada, not as Ca%C3%B1ada.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stateSlug(state: string): string {
  return state.toLowerCase().replace(/[^a-z]/g, "");
}

/** True when a town has enough bookable rooms to be worth a page of its own. */
export function indexableCity(row: Pick<CityRow, "spaceCount">): boolean {
  return row.spaceCount >= MIN_LISTINGS_TO_INDEX;
}

/**
 * True when a town has any live room worth showing a person.
 *
 * The visibility rule for the human-facing directory, kept apart from
 * `indexableCity` on purpose: a town below the indexing bar still has real
 * inventory, and a searcher should be able to find and book it. Every town in
 * `city_inventory` already has at least one live listing, so in practice this
 * lets all of them through — it is written as a predicate anyway so the rule is
 * named where it is read, and cannot silently become the indexing threshold
 * again.
 */
export function discoverableCity(row: Pick<CityRow, "spaceCount">): boolean {
  return row.spaceCount >= MIN_LISTINGS_TO_SHOW;
}

/**
 * The same threshold, plus the one rule that only applies to a use page.
 *
 * A use page has to be a different page from the town page above it. In a town
 * whose every room is a pilates studio, /san-mateo and /san-mateo/pilates-
 * studio list exactly the same rooms — two addresses for one page, which a
 * search engine resolves by picking one and discounting the other, and it does
 * not always pick the one you wanted. So a use page earns its own address only
 * when it is a genuine subset; otherwise it canonicalises up to the town.
 */
export function indexableCityType(row: CityTypeRow, cityCount: number): boolean {
  if (row.spaceCount < MIN_LISTINGS_TO_INDEX) return false;
  return row.spaceCount < cityCount;
}

/**
 * Where a use page points when it is not its own page.
 *
 * Never left to a search engine to work out. A page that duplicates its parent
 * says so, in a canonical tag, and the parent is where the ranking
 * accumulates.
 */
export function canonicalForCityType(row: CityTypeRow, cityCount: number): string {
  const town = `/spaces/${stateSlug(row.state)}/${citySlug(row.city)}`;
  return indexableCityType(row, cityCount) ? `${town}/${row.spaceType}` : town;
}

export function cityPath(state: string, city: string): string {
  return `/spaces/${stateSlug(state)}/${citySlug(city)}`;
}

export function cityTypePath(state: string, city: string, spaceType: string): string {
  return `${cityPath(state, city)}/${spaceType}`;
}

/**
 * Every generated address that has earned a place in the sitemap.
 *
 * Sorted, because a sitemap that reorders itself on every build looks to a
 * crawler like a site that changed when nothing did.
 */
export function indexablePaths(cities: CityRow[], types: CityTypeRow[]): string[] {
  const countByCity = new Map(cities.map((row) => [`${row.state}/${row.city}`, row.spaceCount]));

  const townPaths = cities.filter(indexableCity).map((row) => cityPath(row.state, row.city));

  const usePaths = types
    .filter((row) => {
      const cityCount = countByCity.get(`${row.state}/${row.city}`) ?? 0;
      // A use nobody offers any more should not be a page, whatever the count
      // says — the slug would be one the route refuses to build.
      return spaceTypeBySlug(row.spaceType) !== null && indexableCityType(row, cityCount);
    })
    .map((row) => cityTypePath(row.state, row.city, row.spaceType));

  return [...townPaths, ...usePaths].sort();
}

/** The uses a town actually has rooms for, in the order the site lists them. */
export function usesInCity(types: CityTypeRow[]): CityTypeRow[] {
  const order = new Map(SPACE_TYPES.map((type, index) => [type.slug, index]));
  return types
    .filter((row) => order.has(row.spaceType))
    .sort((a, b) => (order.get(a.spaceType) ?? 0) - (order.get(b.spaceType) ?? 0));
}

/**
 * A price range worth printing, or nothing.
 *
 * The threshold is the same one that decides indexing, and for the same
 * reason: "from $40" off a single listing is not a market rate, it is one
 * host's rate wearing the clothes of a market rate. A page that quotes it is
 * making a claim it cannot support, on the subject people are least forgiving
 * about.
 */
export function priceRange(row: CityRow): { from: number; to: number; median: number } | null {
  if (row.spaceCount < MIN_LISTINGS_TO_INDEX) return null;
  return { from: row.minCents, to: row.maxCents, median: row.medianCents };
}
