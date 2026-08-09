import { describe, expect, it } from "vitest";

import {
  type AccessDetails,
  accessFacts,
  accessUnanswered,
  hasAccessObstacle,
} from "./access-details";

const nothing: AccessDetails = {
  entrance: null,
  floor: null,
  doorwayInches: null,
  restroom: null,
};

const details = (over: Partial<AccessDetails> = {}): AccessDetails => ({ ...nothing, ...over });

describe("accessFacts", () => {
  it("says nothing when nothing was answered", () => {
    expect(accessFacts(nothing)).toEqual([]);
    expect(accessUnanswered(nothing)).toBe(true);
  });

  /**
   * The whole point. A boolean said "accessible" and left somebody to find the
   * step themselves, on the day, having paid.
   */
  it("names the step at the entrance", () => {
    const [fact] = accessFacts(details({ entrance: "one_step" }));

    expect(fact.answer).toContain("One step");
    expect(fact.blocks).toBe(true);
  });

  it("puts them in the order of a journey", () => {
    const facts = accessFacts(
      details({
        entrance: "step_free",
        floor: "lift",
        doorwayInches: 34,
        restroom: "accessible",
      }),
    );

    expect(facts.map((f) => f.question)).toEqual([
      "Entrance",
      "Getting to the room",
      "Narrowest doorway",
      "Restroom",
    ]);
  });

  /**
   * "Wide enough" is a judgement about a body we know nothing about. The
   * number lets somebody make their own.
   */
  it("gives the measurement whether or not it is wide", () => {
    expect(accessFacts(details({ doorwayInches: 28 }))[0].answer).toBe("28 inches");
    expect(accessFacts(details({ doorwayInches: 36 }))[0].answer).toBe("36 inches");
  });

  it("flags a doorway under the comfortable width", () => {
    expect(accessFacts(details({ doorwayInches: 28 }))[0].blocks).toBe(true);
    expect(accessFacts(details({ doorwayInches: 32 }))[0].blocks).toBe(false);
  });

  /**
   * Silence is not a refusal. A host who has not measured a doorway has not
   * said it is narrow, and inventing that answer is the same fault as
   * inventing the opposite one.
   */
  it("leaves out what was never answered", () => {
    const facts = accessFacts(details({ entrance: "step_free" }));

    expect(facts).toHaveLength(1);
    expect(facts.map((f) => f.question)).not.toContain("Restroom");
  });

  it("treats stairs-only as an obstacle and a lift as not", () => {
    expect(accessFacts(details({ floor: "stairs_only" }))[0].blocks).toBe(true);
    expect(accessFacts(details({ floor: "lift" }))[0].blocks).toBe(false);
  });

  /** A standard restroom is not an obstacle to most people; none of it is. */
  it("separates no restroom from a standard one", () => {
    expect(accessFacts(details({ restroom: "none" }))[0].blocks).toBe(true);
    expect(accessFacts(details({ restroom: "standard" }))[0].blocks).toBe(false);
  });
});

describe("hasAccessObstacle", () => {
  it("finds the one problem among several fine answers", () => {
    expect(
      hasAccessObstacle(
        details({ entrance: "step_free", floor: "lift", restroom: "none" }),
      ),
    ).toBe(true);
  });

  it("is false when every answered fact is clear", () => {
    expect(
      hasAccessObstacle(details({ entrance: "step_free", floor: "ground_floor" })),
    ).toBe(false);
  });

  /**
   * And false when nothing was answered — which is why the screen must show
   * "not answered" rather than reading this as a clean bill of health.
   */
  it("is false for an unanswered listing, which is not the same as clear", () => {
    expect(hasAccessObstacle(nothing)).toBe(false);
    expect(accessUnanswered(nothing)).toBe(true);
  });
});
