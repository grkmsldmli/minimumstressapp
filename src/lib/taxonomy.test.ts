import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AMENITIES,
  AMENITY_GROUPS,
  CATEGORY_KEYS,
  GENERIC_USE,
  ROOM_SETUPS,
  REQUIREMENTS,
  amenitiesIn,
  amenityLabel,
  isRoomSetupKey,
  knownAmenities,
  roomSetupLabel,
} from "./taxonomy";
import { spaceTypeBySlug } from "./space-types";

/**
 * What a practitioner will find in the room.
 *
 * The old list described the building and nothing else — mirrors, climate
 * control, natural light — so somebody looking at a treatment room could not
 * tell whether there was a table in it. That is the first question after the
 * price, and these tests exist so the answer cannot quietly go missing again.
 */

describe("the amenity list", () => {
  it("has unique keys", () => {
    const keys = AMENITIES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts every entry in a group the page renders", () => {
    const headings = new Set(AMENITY_GROUPS.map((g) => g.group));
    for (const amenity of AMENITIES) {
      expect(headings, amenity.key).toContain(amenity.group);
    }
  });

  /*
   * The point of the whole change. A room can now say it has a table, a
   * reformer, chairs — the things that decide whether the work can happen at
   * all, as opposed to whether the room is pleasant.
   */
  it("can describe what is actually in a room", () => {
    const equipment = amenitiesIn("equipment").map((a) => a.key);
    for (const needed of ["treatment_table", "reformers", "seating", "mats", "linens"]) {
      expect(equipment, needed).toContain(needed);
    }
  });

  it("still describes the room itself", () => {
    const room = amenitiesIn("room").map((a) => a.key);
    for (const needed of ["natural_light", "soundproofed", "sink", "private_entrance"]) {
      expect(room, needed).toContain(needed);
    }
  });

  /*
   * A waiting area could only be denied, never offered: "No waiting area for
   * clients" was a requirement and there was no opposite. The thing worth
   * advertising was the one a host could not mention.
   */
  it("lets a host say they have a waiting area rather than only that they do not", () => {
    expect(amenitiesIn("room").map((a) => a.key)).toContain("waiting_area");
    expect(REQUIREMENTS.map((r) => r.key)).not.toContain("no_waiting_area");
  });

  it("keeps a label for everything it offers", () => {
    for (const amenity of AMENITIES) {
      expect(amenityLabel(amenity.key), amenity.key).toBe(amenity.label);
    }
    expect(amenityLabel("sauna")).toBeNull();
  });

  it("drops anything not on the list, rather than the listing", () => {
    expect(knownAmenities(["mirrors", "sauna", "mirrors", ""])).toEqual(["mirrors"]);
  });
});

/**
 * Whether the room is theirs for the hour.
 *
 * Constrained in the database, so the two lists have to agree — a value the
 * app offers and the database refuses costs a host their listing at submit.
 */
describe("room setup", () => {
  const MIGRATION = "supabase/migrations/0045_what_is_in_the_room.sql";

  it("matches the check constraint exactly", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const block = sql.match(/room_setup in \(([^)]*)\)/);
    expect(block, "no room_setup constraint found").not.toBeNull();

    const allowed = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual(ROOM_SETUPS.map((s) => s.key).sort());
  });

  it("says something useful about each", () => {
    for (const setup of ROOM_SETUPS) {
      expect(setup.detail.length, setup.key).toBeGreaterThan(20);
      expect(roomSetupLabel(setup.key)).toBe(setup.label);
    }
  });

  it("refuses a value that is not one of ours", () => {
    expect(isRoomSetupKey("private_room")).toBe(true);
    expect(isRoomSetupKey("shared_desk")).toBe(false);
    expect(roomSetupLabel("shared_desk")).toBeNull();
  });
});

/**
 * The homepage's "Explore by space" cards open the search on GENERIC_USE[key].
 * If any value here is not a real space-type slug, the card routes to a use the
 * search cannot answer — the exact class of broken link this guards against.
 */
describe("the generic use each category opens on", () => {
  it("covers every category", () => {
    for (const key of CATEGORY_KEYS) {
      expect(GENERIC_USE[key], key).toBeTruthy();
    }
  });

  it("is always a real, supported space-type slug", () => {
    for (const key of CATEGORY_KEYS) {
      expect(spaceTypeBySlug(GENERIC_USE[key]), `${key} -> ${GENERIC_USE[key]}`).not.toBeNull();
    }
  });

  it("maps each of the four cards to its broadest use", () => {
    // The mapping the four marketing cards depend on, pinned so a rename cannot
    // silently point "Movement Studios" at a meditation room.
    expect(GENERIC_USE).toEqual({
      physical: "movement-studio", // Movement Studios
      traditional: "treatment-room", // Holistic Practice Rooms
      social: "consultation-room", // Consultation & Coaching Rooms
      spirit: "meditation-room", // Meditation & Breathwork Spaces
    });
  });

  it("opens a use that belongs to the category it stands for", () => {
    // The whole basis of the type-filtered /spaces: a card's use resolves back
    // to its own category, so "Movement Studios" (movement-studio → physical)
    // filters to physical listings and never to another category's rooms.
    for (const key of CATEGORY_KEYS) {
      expect(spaceTypeBySlug(GENERIC_USE[key])!.category, key).toBe(key);
    }
  });
});
