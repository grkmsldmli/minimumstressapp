import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SPACE_TYPES, knownSpaceTypes, spaceTypeBySlug, spaceTypesFor } from "./space-types";
import { CATEGORIES, type CategoryKey } from "./taxonomy";

/**
 * The list that becomes URLs.
 *
 * Every slug here is a page a search engine will index and somebody will link
 * to, so the tests are mostly about the ways this list can quietly go wrong:
 * two spellings of the same thing, a slug that cannot go in a URL, a use with
 * no room type behind it, and — the one that actually costs a listing — the
 * database and this file disagreeing about what is allowed.
 */

const MIGRATION = "supabase/migrations/0043_where_a_space_is_and_what_it_suits.sql";

describe("the slugs", () => {
  it("are unique", () => {
    const slugs = SPACE_TYPES.map((type) => type.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  /** A URL segment, so: lowercase, hyphens, nothing needing encoding. */
  it("are all safe in a path", () => {
    for (const type of SPACE_TYPES) {
      expect(type.slug, type.slug).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(encodeURIComponent(type.slug), type.slug).toBe(type.slug);
    }
  });

  it("belong to a category that exists", () => {
    const known = new Set(CATEGORIES.map((category) => category.key));
    for (const type of SPACE_TYPES) {
      expect(known, type.slug).toContain(type.category);
    }
  });

  /*
   * A category with no uses is a room type whose listings can never appear on
   * a page built around what they are for — which is every page in this plan.
   */
  it("leaves no category without one", () => {
    for (const category of CATEGORIES) {
      expect(spaceTypesFor(category.key).length, category.key).toBeGreaterThan(0);
    }
  });

  it("has a name and a plural for each", () => {
    for (const type of SPACE_TYPES) {
      expect(type.label.length, type.slug).toBeGreaterThan(2);
      expect(type.plural, type.slug).not.toBe(type.label);
      expect(type.blurb.length, type.slug).toBeGreaterThan(30);
    }
  });
});

/**
 * The word this list does not use.
 *
 * Renting a room to a licensed massage therapist is one thing; advertising a
 * "therapy office" is a claim about clinical practice, and the platform says
 * in its own terms that it provides no therapeutic or psychological service.
 * The room that would carry that name is a Consultation Room here.
 */
describe("what the names claim", () => {
  it("never says therapy", () => {
    const offending = SPACE_TYPES.filter((type) =>
      /therap/i.test(`${type.slug} ${type.label} ${type.plural} ${type.blurb}`),
    );
    expect(offending.map((type) => type.slug)).toEqual([]);
  });
});

/**
 * The check constraint in 0043 and this file, compared.
 *
 * These two lists have to agree or a host loses a listing: the insert names a
 * use the database has never heard of, the constraint rejects the whole row,
 * and what the host sees is a submit button that failed for no stated reason.
 * Read out of the migration rather than restated, because a copy of the list
 * in a test is one more thing that can drift.
 */
describe("the database agrees", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  const constrained = (() => {
    const block = sql.match(/suitable_for <@ array\[([\s\S]*?)\]::text\[\]/);
    if (!block) throw new Error(`no suitable_for constraint found in ${MIGRATION}`);
    return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  })();

  it("allows exactly the uses this file defines", () => {
    expect([...constrained].sort()).toEqual(SPACE_TYPES.map((type) => type.slug).sort());
  });

  it("indexes the columns the city pages filter on", () => {
    // Without these two, every city page is a sequential scan of every
    // listing — which is fine at ten rooms and is not the point at ten
    // thousand.
    expect(sql).toContain("spaces_active_place_idx");
    expect(sql).toContain("using gin (suitable_for)");
  });

  /*
   * What the public view may and may not carry is checked against a real
   * database in supabase/schema.test.ts, where the columns can be read off the
   * catalogue instead of matched in a string. An earlier version of this test
   * asserted here that the street address was absent, which had been true
   * until 0032 published it deliberately — the SQL text is the wrong place to
   * ask, because it cannot see the eleven migrations before this one.
   */
});

describe("knownSpaceTypes", () => {
  it("keeps the ones that exist, in the order given", () => {
    expect(knownSpaceTypes(["yoga-studio", "pilates-studio"])).toEqual([
      "yoga-studio",
      "pilates-studio",
    ]);
  });

  /*
   * A stale tab posting a use that has since been renamed should cost the use,
   * not the listing. The database would refuse the whole row.
   */
  it("drops anything not on the list", () => {
    expect(knownSpaceTypes(["yoga-studio", "therapy-office", ""])).toEqual(["yoga-studio"]);
  });

  it("drops repeats", () => {
    expect(knownSpaceTypes(["yoga-studio", "yoga-studio"])).toEqual(["yoga-studio"]);
  });
});

describe("spaceTypeBySlug", () => {
  it("finds one", () => {
    expect(spaceTypeBySlug("massage-room")?.label).toBe("Massage Room");
  });

  it("returns null for a slug that is not ours, rather than guessing", () => {
    for (const slug of ["", "therapy-office", "../../admin", "Massage-Room"]) {
      expect(spaceTypeBySlug(slug), slug).toBeNull();
    }
  });

  it("agrees with the category grouping", () => {
    for (const category of CATEGORIES) {
      for (const type of spaceTypesFor(category.key as CategoryKey)) {
        expect(spaceTypeBySlug(type.slug)?.category).toBe(category.key);
      }
    }
  });
});
