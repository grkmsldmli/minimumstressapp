import { describe, expect, it } from "vitest";

import { idFromSlug, isListingSlug, listingPath, listingSlug, uuidPrefixRange } from "./listing-url";
import { SPACE_TYPES } from "./space-types";

/**
 * A listing's address, and the two ways it could go wrong.
 *
 * It shares a path segment with the use pages, so the first job is that a room
 * and a category of rooms can never be mistaken for each other. The second is
 * that the address survives the host renaming their studio — otherwise every
 * link and every bit of ranking the page earned is thrown away by an edit
 * nobody thought was dangerous.
 */

const ID = "3f2a91c4-7b0e-4d55-9a11-8c6e2f0b4d77";

describe("a listing's slug", () => {
  it("reads as the room, and ends in enough of the id to find it", () => {
    expect(listingSlug("Bright Pilates Studio", ID)).toBe("bright-pilates-studio-3f2a91c4");
  });

  it("survives punctuation, accents and shouting", () => {
    expect(listingSlug("Sage House — Room #2", ID)).toBe("sage-house-room-2-3f2a91c4");
    expect(listingSlug("Cañada Wellness", ID)).toBe("canada-wellness-3f2a91c4");
    expect(listingSlug("THE ANNEX", ID)).toBe("the-annex-3f2a91c4");
  });

  /** A room named entirely in emoji still needs somewhere to live. */
  it("still produces an address when the name survives nothing", () => {
    expect(listingSlug("★★★", ID)).toBe("room-3f2a91c4");
    expect(listingSlug("", ID)).toBe("room-3f2a91c4");
  });

  it("does not run on forever", () => {
    const slug = listingSlug("A".repeat(200), ID);
    expect(slug.length).toBeLessThan(80);
    expect(slug.endsWith("-3f2a91c4")).toBe(true);
  });
});

describe("finding the room again", () => {
  it("reads the id back out", () => {
    expect(idFromSlug(listingSlug("Bright Pilates Studio", ID))).toBe("3f2a91c4");
  });

  /*
   * The whole reason the id is there. A host renames the studio, every old
   * link still resolves, and the page keeps what it earned.
   */
  it("finds the same room after it has been renamed", () => {
    const before = listingSlug("Willow", ID);
    const after = listingSlug("Willow Studio & Annexe", ID);

    expect(before).not.toBe(after);
    expect(idFromSlug(before)).toBe(idFromSlug(after));
  });

  it("answers null for something that is not one", () => {
    for (const slug of ["", "pilates-studio", "room", "bright-studio-zzzzzzzz"]) {
      expect(idFromSlug(slug), slug).toBeNull();
    }
  });
});

/**
 * The collision that would matter, and cannot happen.
 *
 * /spaces/ca/belmont/pilates-studio is a category. Somewhere in the same
 * position, /spaces/ca/belmont/bright-pilates-studio-3f2a91c4 is one room.
 */
describe("a room is never mistaken for a category", () => {
  it.each(SPACE_TYPES.map((t) => t.slug))("%s stays a category", (slug) => {
    expect(isListingSlug(slug)).toBe(false);
  });

  it("recognises a room", () => {
    expect(isListingSlug(listingSlug("Bright Pilates Studio", ID))).toBe(true);
  });

  /*
   * By construction rather than by luck: every listing slug carries an id, so
   * no host can name a room into a category's address however hard they try.
   */
  it("cannot be tricked by a host naming their room after a category", () => {
    for (const type of SPACE_TYPES) {
      const slug = listingSlug(type.label, ID);
      expect(slug, type.slug).not.toBe(type.slug);
      expect(isListingSlug(slug)).toBe(true);
    }
  });
});

describe("the path", () => {
  const room = { id: ID, name: "Bright Pilates Studio", state: "CA", city: "Belmont" };

  it("puts the town in it", () => {
    expect(listingPath(room)).toBe("/spaces/ca/belmont/bright-pilates-studio-3f2a91c4");
  });

  /*
   * A room the geocoder could not place has no town to live under. It stays
   * bookable in the app and has no page out here — better than a page
   * claiming a town it may not be in.
   */
  it("declines to invent one for a room with no town", () => {
    expect(listingPath({ ...room, city: null })).toBeNull();
    expect(listingPath({ ...room, state: null })).toBeNull();
  });
});

/**
 * How the eight characters in the URL become a lookup that Postgres will run.
 *
 * The bug this replaces: `id like '4e313239%'` against a uuid column throws
 * (`operator does not exist: uuid ~~ unknown`, 42883), so every listing page
 * 404'd. A bounded range on the id compares uuid to uuid — no `like`, no cast —
 * and brackets exactly the ids whose first group is the prefix.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("the id-prefix range a listing URL resolves through", () => {
  it("brackets the first group with the rest at its minimum and maximum", () => {
    expect(uuidPrefixRange("3f2a91c4")).toEqual({
      min: "3f2a91c4-0000-0000-0000-000000000000",
      max: "3f2a91c4-ffff-ffff-ffff-ffffffffffff",
    });
  });

  /*
   * The whole point: the bounds are real uuids, so the query is `>=`/`<=`
   * between uuids — never `like` on a uuid, which is the error that took every
   * listing page down.
   */
  it("produces bounds that are valid uuids, so the comparison stays uuid-to-uuid", () => {
    const range = uuidPrefixRange("4e313239");
    expect(range).not.toBeNull();
    expect(range!.min).toMatch(UUID);
    expect(range!.max).toMatch(UUID);
  });

  it("contains the id the slug was built from, and sorts inside the bounds", () => {
    const short = idFromSlug(listingSlug("Reformer Hit", ID))!;
    const range = uuidPrefixRange(short)!;
    // uuid comparison is byte order, which for canonical lowercase form is the
    // same as comparing the strings — so the real id sits within the bounds.
    expect(range.min <= ID).toBe(true);
    expect(ID <= range.max).toBe(true);
  });

  it("returns null for anything that is not exactly eight lowercase hex", () => {
    for (const bad of ["", "4e31323", "4e3132399", "4E313239", "4e31323g", "zzzzzzzz", "4e31 239"]) {
      expect(uuidPrefixRange(bad), bad).toBeNull();
    }
  });
});
