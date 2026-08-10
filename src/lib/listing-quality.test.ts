import { describe, expect, it } from "vitest";

import { MIN_DESCRIPTION_CHARS, describesTheRoom, listingGaps } from "./listing-quality";

type Listing = Parameters<typeof listingGaps>[0];

const COMPLETE: Listing = {
  description: "Bright corner room with a sprung floor, quiet after six.",
  amenities: ["mats", "mirrors"],
  access: {
    entrance: "step_free",
    floor: "ground_floor",
    doorwayInches: 34,
    restroom: "accessible",
  },
  mediaCount: 3,
};

const listing = (over: Partial<Listing> = {}) => listingGaps({ ...COMPLETE, ...over });

describe("describing the room", () => {
  /**
   * The listings that prompted this. "Magic Show" is the room's own name and
   * seventeen characters of nothing — it passed a non-empty check, which is
   * why the check is a length.
   */
  it("refuses a label in place of a description", () => {
    expect(describesTheRoom("Magic Show")).toBe(false);
    expect(describesTheRoom("Nice room")).toBe(false);
    expect(describesTheRoom("")).toBe(false);
  });

  it("accepts one real sentence", () => {
    expect(describesTheRoom("Bright room, wooden floor, quiet street outside.")).toBe(true);
  });

  it("does not count whitespace as effort", () => {
    expect(describesTheRoom(" ".repeat(MIN_DESCRIPTION_CHARS + 10))).toBe(false);
    expect(describesTheRoom(`  ${"a".repeat(MIN_DESCRIPTION_CHARS)}  `)).toBe(true);
  });
});

describe("what a listing is still missing", () => {
  it("says nothing when there is nothing to say", () => {
    expect(listing()).toEqual([]);
  });

  it("asks for a description first, because it is read first", () => {
    expect(listing({ description: "Magic Show" })[0].label).toMatch(/description/i);
  });

  /**
   * One answer is enough to stop asking. The point is that somebody thought
   * about it, not that all four are filled — a host who answered the entrance
   * and left the doorway blank has still told a practitioner something.
   */
  it("asks about access only when none of it is answered", () => {
    const none = listing({
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
    });
    expect(none.some((g) => /gets in/i.test(g.label))).toBe(true);

    const some = listing({
      access: { entrance: "step_free", floor: null, doorwayInches: null, restroom: null },
    });
    expect(some.some((g) => /gets in/i.test(g.label))).toBe(false);
  });

  it("asks for more photos below three", () => {
    expect(listing({ mediaCount: 1 }).some((g) => /photos/i.test(g.label))).toBe(true);
    expect(listing({ mediaCount: 3 }).some((g) => /photos/i.test(g.label))).toBe(false);
  });

  it("asks what the room comes with when barely anything is listed", () => {
    expect(listing({ amenities: [] }).some((g) => /comes with/i.test(g.label))).toBe(true);
    expect(listing({ amenities: ["mats"] }).some((g) => /comes with/i.test(g.label))).toBe(true);
    expect(listing({ amenities: ["mats", "mirrors"] }).some((g) => /comes with/i.test(g.label))).toBe(
      false,
    );
  });

  /**
   * The three listings that were actually live: photos and house rules, no
   * description anybody could use, and not one accessibility answer between
   * them.
   */
  it("catches the listings this was written for", () => {
    const gaps = listing({
      description: "",
      amenities: ["mats"],
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
      mediaCount: 3,
    });

    expect(gaps.map((g) => g.label)).toEqual([
      "A description of the room",
      "How somebody gets in",
      "What the room comes with",
    ]);
  });

  /** Every ask says why, or it reads as paperwork and gets ignored. */
  it("explains each one in terms of a booking", () => {
    for (const gap of listing({ description: "", amenities: [], mediaCount: 0 })) {
      expect(gap.because.length).toBeGreaterThan(20);
    }
  });
});
