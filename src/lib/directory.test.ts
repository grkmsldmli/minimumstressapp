import { describe, expect, it } from "vitest";

import {
  type CityRow,
  type CityTypeRow,
  MIN_LISTINGS_TO_INDEX,
  canonicalForCityType,
  citySlug,
  cityPath,
  indexableCity,
  indexableCityType,
  indexablePaths,
  priceRange,
  stateSlug,
} from "./directory";

/**
 * The rule that decides which generated pages a search engine is shown.
 *
 * It is the most important thing in this part of the site and the easiest to
 * get quietly wrong, because every failure mode looks fine locally: the pages
 * render, the links work, and the damage is a judgement a crawler forms over
 * months about a site that turned out to be mostly empty addresses.
 */

const city = (over: Partial<CityRow> = {}): CityRow => ({
  state: "CA",
  city: "San Mateo",
  spaceCount: 5,
  minCents: 3500,
  maxCents: 8000,
  medianCents: 5000,
  ...over,
});

const cityType = (over: Partial<CityTypeRow> = {}): CityTypeRow => ({
  ...city(),
  spaceType: "pilates-studio",
  ...over,
});

describe("slugs", () => {
  it("turn a town into something that can go in a URL", () => {
    expect(citySlug("San Mateo")).toBe("san-mateo");
    expect(citySlug("South San Francisco")).toBe("south-san-francisco");
    expect(stateSlug("CA")).toBe("ca");
  });

  /*
   * Lossy on purpose. Somebody typing either spelling should reach the same
   * page, and a percent-encoded accent in a URL is unreadable and unlinkable.
   */
  it("flatten the punctuation people write two ways", () => {
    expect(citySlug("St. Helena")).toBe(citySlug("St Helena"));
    expect(citySlug("La Cañada Flintridge")).toBe("la-canada-flintridge");
    expect(citySlug("  Palo   Alto  ")).toBe("palo-alto");
  });

  it("never produce a leading or trailing dash", () => {
    for (const name of ["St. Helena", "  Belmont  ", "!!!Foster City!!!"]) {
      const slug = citySlug(name);
      expect(slug.startsWith("-"), name).toBe(false);
      expect(slug.endsWith("-"), name).toBe(false);
    }
  });

  it("builds a path from them", () => {
    expect(cityPath("CA", "San Mateo")).toBe("/spaces/ca/san-mateo");
  });
});

describe("when a town page is worth indexing", () => {
  it("is not, below the threshold", () => {
    for (let count = 0; count < MIN_LISTINGS_TO_INDEX; count++) {
      expect(indexableCity({ spaceCount: count }), `${count} rooms`).toBe(false);
    }
  });

  it("is, at it and above it", () => {
    expect(indexableCity({ spaceCount: MIN_LISTINGS_TO_INDEX })).toBe(true);
    expect(indexableCity({ spaceCount: 40 })).toBe(true);
  });
});

/**
 * The rule that only applies to a use page: it has to be a different page from
 * the town page above it.
 */
describe("when a use page is worth its own address", () => {
  it("is, when it is a real subset of the town", () => {
    expect(indexableCityType(cityType({ spaceCount: 4 }), 10)).toBe(true);
  });

  /*
   * The duplicate. In a town whose every room is a pilates studio, the two
   * pages list identical rooms — and a search engine resolves two addresses
   * for one page by picking one and discounting the other, not always the one
   * you wanted.
   */
  it("is not, when it lists every room the town has", () => {
    expect(indexableCityType(cityType({ spaceCount: 6 }), 6)).toBe(false);
  });

  it("is not, below the threshold, however small the town", () => {
    expect(indexableCityType(cityType({ spaceCount: 2 }), 50)).toBe(false);
  });

  it("says where it points when it is not its own page", () => {
    const duplicate = cityType({ spaceCount: 6 });
    expect(canonicalForCityType(duplicate, 6)).toBe("/spaces/ca/san-mateo");

    const distinct = cityType({ spaceCount: 4 });
    expect(canonicalForCityType(distinct, 10)).toBe("/spaces/ca/san-mateo/pilates-studio");
  });
});

describe("what goes in the sitemap", () => {
  /*
   * The state the site is in today, and the one the engine has to be correct
   * for first. No listings means no towns, which means no addresses — a
   * generator that produces them anyway is the thousand-thin-pages failure,
   * arriving before there is anything to show.
   */
  it("is nothing at all while there are no listings", () => {
    expect(indexablePaths([], [])).toEqual([]);
  });

  it("is still nothing when the only town is below the threshold", () => {
    const thin = city({ city: "Belmont", spaceCount: 2 });
    expect(indexablePaths([thin], [cityType({ city: "Belmont", spaceCount: 2 })])).toEqual([]);
  });

  it("names a town once it has enough, and the uses that differ from it", () => {
    const paths = indexablePaths(
      [city({ city: "San Mateo", spaceCount: 10 })],
      [
        cityType({ city: "San Mateo", spaceType: "pilates-studio", spaceCount: 4 }),
        // Every room in town, so this page is the town page.
        cityType({ city: "San Mateo", spaceType: "movement-studio", spaceCount: 10 }),
        // Too few to be worth an address of its own.
        cityType({ city: "San Mateo", spaceType: "yoga-studio", spaceCount: 1 }),
      ],
    );

    expect(paths).toEqual([
      "/spaces/ca/san-mateo",
      "/spaces/ca/san-mateo/pilates-studio",
    ]);
  });

  /*
   * A use retired since the row was written must not become an address. The
   * route would refuse to build it, and a sitemap naming a URL that 404s costs
   * more than the page would have earned.
   */
  it("never names a use the site no longer offers", () => {
    const paths = indexablePaths(
      [city({ spaceCount: 20 })],
      [cityType({ spaceType: "therapy-office", spaceCount: 8 })],
    );
    expect(paths).toEqual(["/spaces/ca/san-mateo"]);
  });

  it("comes out in a stable order", () => {
    const rows = [
      city({ city: "Belmont", spaceCount: 5 }),
      city({ city: "Atherton", spaceCount: 5 }),
    ];
    expect(indexablePaths(rows, [])).toEqual(indexablePaths([...rows].reverse(), []));
    expect(indexablePaths(rows, [])).toEqual(["/spaces/ca/atherton", "/spaces/ca/belmont"]);
  });
});

/**
 * The number people are least forgiving about.
 *
 * "From $40" off a single listing is not a market rate — it is one host's rate
 * wearing a market rate's clothes, and a page that prints it is making a claim
 * it cannot support on the subject a reader will check hardest.
 */
describe("a price range", () => {
  it("is withheld until there are enough rooms to mean anything", () => {
    expect(priceRange(city({ spaceCount: 1 }))).toBeNull();
    expect(priceRange(city({ spaceCount: MIN_LISTINGS_TO_INDEX - 1 }))).toBeNull();
  });

  it("is the real spread once there are", () => {
    expect(priceRange(city({ spaceCount: 6, minCents: 3000, maxCents: 9000, medianCents: 5500 })))
      .toEqual({ from: 3000, to: 9000, median: 5500 });
  });

  /*
   * The same threshold as indexing, deliberately. A page not worth showing a
   * crawler is a page not worth quoting a market from either, and two
   * different numbers here would be two rules to keep in step.
   */
  it("uses the same threshold as indexing", () => {
    const edge = city({ spaceCount: MIN_LISTINGS_TO_INDEX });
    expect(indexableCity(edge)).toBe(true);
    expect(priceRange(edge)).not.toBeNull();
  });
});
