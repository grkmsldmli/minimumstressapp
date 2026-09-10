import { describe, expect, it } from "vitest";

import {
  BOOKING_USES,
  DEFAULT_USES,
  OPT_IN_USES,
  defaultUsesFor,
  HOST_USES,
  MIN_OTHER_CHARS,
  PROHIBITED_USES,
  type SpaceRules,
  allowsUse,
  bookingUse,
  checkDeclaredUse,
  explainUseRejection,
  knownUses,
} from "./booking-use";

/**
 * The cases in here are the ones the product was specified against, written as
 * the scenarios rather than as unit tests of each branch — an instructor with
 * six people, somebody bringing ten to a room that holds six.
 */

const rules = (over: Partial<SpaceRules> = {}): SpaceRules => ({
  allowedUses: ["movement_session", "group_class", "client_session"],
  capacity: 8,
  ...over,
});

describe("the platform's floor", () => {
  /*
   * The prohibitions are not options. If one of them ever appears in the menu
   * a host picks from, a host can allow it — which is the one thing this list
   * exists to prevent.
   */
  it("is never something a host can choose", () => {
    const offered = HOST_USES.map((use) => `${use.key} ${use.label} ${use.hostLabel}`.toLowerCase());
    for (const banned of ["sexual", "escort", "pornograph", "prostitut", "party", "parties"]) {
      expect(offered.filter((entry) => entry.includes(banned)), banned).toEqual([]);
    }
  });

  it("is stated rather than implied", () => {
    expect(PROHIBITED_USES.length).toBeGreaterThan(8);
    for (const line of PROHIBITED_USES) expect(line.length).toBeGreaterThan(10);
  });
});

describe("a movement session", () => {
  /** Case A: a teacher booking a studio for a small movement session. */
  it("can book a movement studio the host offers it for", () => {
    expect(
      checkDeclaredUse({ purpose: "movement_session", attendees: 2 }, rules()),
    ).toBeNull();
  });
});

describe("an instructor with a small group", () => {
  /** Case B: six people into a room that holds eight, and the host allows classes. */
  it("can book when the host allows classes and the room is big enough", () => {
    expect(checkDeclaredUse({ purpose: "group_class", attendees: 6 }, rules())).toBeNull();
  });
});

describe("more people than the room holds", () => {
  /** Case C. */
  it("is refused", () => {
    expect(checkDeclaredUse({ purpose: "group_class", attendees: 10 }, rules({ capacity: 6 }))).toBe(
      "too_many_attendees",
    );
  });

  it("says the number the room actually takes", () => {
    expect(explainUseRejection("too_many_attendees", rules({ capacity: 6 }))).toContain("6");
  });

  it("counts the person booking", () => {
    expect(checkDeclaredUse({ purpose: "group_class", attendees: 8 }, rules({ capacity: 8 }))).toBeNull();
    expect(checkDeclaredUse({ purpose: "group_class", attendees: 9 }, rules({ capacity: 8 }))).toBe(
      "too_many_attendees",
    );
  });

  it("refuses a nonsense count rather than reading it as one person", () => {
    for (const attendees of [0, -1, 2.5, Number.NaN]) {
      expect(checkDeclaredUse({ purpose: "group_class", attendees }, rules()), String(attendees)).toBe(
        "attendees_missing",
      );
    }
  });
});

describe("a use the host does not offer", () => {
  /** Case D: the host has not ticked filming. */
  it("is refused", () => {
    expect(checkDeclaredUse({ purpose: "filming", attendees: 2 }, rules())).toBe("use_not_allowed");
  });

  /*
   * The listings that existed before hosts were ever asked this question have
   * an empty list. Reading that as "nothing is allowed" would have taken every
   * room off the market on the day the migration ran.
   */
  it("is allowed while a host has not answered yet", () => {
    expect(allowsUse({ allowedUses: [], capacity: 4 }, "filming")).toBe(true);
    expect(checkDeclaredUse({ purpose: "filming", attendees: 2 }, rules({ allowedUses: [] }))).toBeNull();
  });
});

describe("the declaration itself", () => {
  it("is required", () => {
    expect(checkDeclaredUse(null, rules())).toBe("purpose_missing");
    expect(checkDeclaredUse({ purpose: "", attendees: 2 }, rules())).toBe("purpose_missing");
  });

  it("has to be one of ours", () => {
    expect(checkDeclaredUse({ purpose: "whatever", attendees: 2 }, rules())).toBe("purpose_unknown");
  });

  /*
   * An unexplained "other" records nothing, and the record is the whole point:
   * it is what a later dispute is measured against.
   */
  it("makes 'something else' say what else", () => {
    const allowsOther = rules({ allowedUses: ["other"] });
    expect(checkDeclaredUse({ purpose: "other", attendees: 2 }, allowsOther)).toBe(
      "purpose_needs_detail",
    );
    expect(
      checkDeclaredUse({ purpose: "other", purposeNote: "   ", attendees: 2 }, allowsOther),
    ).toBe("purpose_needs_detail");
    expect(
      checkDeclaredUse(
        { purpose: "other", purposeNote: "x".repeat(MIN_OTHER_CHARS), attendees: 2 },
        allowsOther,
      ),
    ).toBeNull();
  });

  it("does not ask the other purposes for a note", () => {
    expect(checkDeclaredUse({ purpose: "movement_session", attendees: 1 }, rules())).toBeNull();
  });
});

describe("the vocabulary", () => {
  it("has unique keys and both labels on every use", () => {
    const keys = BOOKING_USES.map((use) => use.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const use of BOOKING_USES) {
      expect(use.label.length, use.key).toBeGreaterThan(3);
      expect(use.hostLabel.length, use.key).toBeGreaterThan(3);
    }
  });

  it("resolves a key and refuses one that is not ours", () => {
    expect(bookingUse("movement_session")?.label).toBe("Yoga, Pilates or movement session");
    expect(bookingUse("personal_practice")).toBeNull();
    expect(bookingUse("dance_rehearsal")).toBeNull();
    expect(bookingUse("therapy")).toBeNull();
    expect(bookingUse("")).toBeNull();
  });

  /** A stale form should cost the choice, not the listing. */
  it("drops unknown and repeated keys", () => {
    expect(knownUses(["group_class", "nope", "group_class"])).toEqual(["group_class"]);
  });

  it("gives every rejection a sentence", () => {
    const reasons = [
      "purpose_missing",
      "purpose_unknown",
      "purpose_needs_detail",
      "use_not_allowed",
      "attendees_missing",
      "too_many_attendees",
    ] as const;
    for (const reason of reasons) {
      expect(explainUseRejection(reason, rules()).length, reason).toBeGreaterThan(20);
    }
  });
});

/**
 * What a host gets without answering, and what they have to ask for.
 *
 * Everything ticked was the first version and it was backwards: a host who
 * scrolled past the question would have agreed to a class of strangers, a
 * workshop and a camera — the three things they would most likely have wanted
 * to decline. Nothing ticked is the other failure, an unbookable listing.
 */
describe("what a room is offered for by default", () => {
  it("never pre-selects the uses that bring other people or a camera", () => {
    for (const category of ["physical", "social", "traditional", "spirit"]) {
      const defaults = defaultUsesFor(category);
      for (const risky of OPT_IN_USES) {
        expect(defaults, `${category} pre-selected ${risky}`).not.toContain(risky);
      }
    }
  });

  it("still leaves every room bookable for something", () => {
    for (const category of ["physical", "social", "traditional", "spirit"]) {
      expect(defaultUsesFor(category).length, category).toBeGreaterThan(0);
    }
  });

  it("follows the room type", () => {
    expect(defaultUsesFor("physical")).toContain("movement_session");
    expect(defaultUsesFor("spirit")).toContain("meditation");
    expect(defaultUsesFor("traditional")).toContain("client_session");
  });

  it("gives an unknown category something rather than nothing", () => {
    expect(defaultUsesFor("whatever").length).toBeGreaterThan(0);
  });

  /** Every default has to be a real use, or a listing ships with a dead key. */
  it("only names uses that exist", () => {
    for (const category of Object.keys(DEFAULT_USES)) {
      for (const key of DEFAULT_USES[category]) {
        expect(bookingUse(key), `${category}/${key}`).not.toBeNull();
      }
    }
  });
});
