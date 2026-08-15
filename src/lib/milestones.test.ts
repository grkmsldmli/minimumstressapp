import { describe, expect, it } from "vitest";

import {
  MILESTONES,
  type HostFacts,
  type PractitionerFacts,
  celebrationDue,
  earnedByHost,
  earnedByPractitioner,
  hostTotal,
  milestone,
  practitionerTotal,
} from "./milestones";

/**
 * The stretch badges.ts leaves empty.
 *
 * A hundred sessions is a year for a studio taking two bookings a week, and
 * the badge card renders nothing below twenty-five. These cover the part of
 * that year where somebody decides whether to stay, so the rules for when each
 * one lands are worth pinning: a moment announced early is a lie, and one
 * announced late is a moment missed.
 */
const NO_HOST: HostFacts = {
  liveListings: 0,
  bookingsReceived: 0,
  sessionsHosted: 0,
  reviewsReceived: 0,
  payoutsReceived: 0,
  earnedCents: 0,
};

const NO_PRACTITIONER: PractitionerFacts = {
  bookingsMade: 0,
  sessionsHeld: 0,
  reviewsReceived: 0,
  roomsReturnedTo: 0,
  roomsUsed: 0,
};

describe("a host's first year", () => {
  it("says nothing to somebody who has not started", () => {
    expect(earnedByHost(NO_HOST)).toEqual([]);
  });

  it("marks the listing going live", () => {
    expect(earnedByHost({ ...NO_HOST, liveListings: 1 })).toEqual(["host_listed"]);
  });

  /**
   * A booking is not a session. Somebody who booked and cancelled has not had
   * a session in their room, and telling them they did would be the app
   * congratulating them for something that did not happen.
   */
  it("does not count a booking as a session", () => {
    const earned = earnedByHost({ ...NO_HOST, liveListings: 1, bookingsReceived: 1 });

    expect(earned).toContain("host_first_booking");
    expect(earned).not.toContain("host_first_session");
  });

  it("marks the first session, the first review and the first payout separately", () => {
    const earned = earnedByHost({
      ...NO_HOST,
      liveListings: 1,
      bookingsReceived: 1,
      sessionsHosted: 1,
      reviewsReceived: 1,
      payoutsReceived: 1,
      earnedCents: 4500,
    });

    expect(earned).toEqual([
      "host_listed",
      "host_first_booking",
      "host_first_session",
      "host_first_review",
      "host_first_payout",
    ]);
  });

  /**
   * A session having happened does not mean the money has arrived — it lands
   * about two business days later. Somebody told their first payout arrived
   * before it did would go and look at an account with nothing in it.
   */
  it("waits for the money before saying the money arrived", () => {
    const earned = earnedByHost({ ...NO_HOST, sessionsHosted: 3, payoutsReceived: 0 });

    expect(earned).toContain("host_first_session");
    expect(earned).not.toContain("host_first_payout");
  });

  it("adds the tenth session only at ten", () => {
    expect(earnedByHost({ ...NO_HOST, sessionsHosted: 9 })).not.toContain("host_ten_sessions");
    expect(earnedByHost({ ...NO_HOST, sessionsHosted: 10 })).toContain("host_ten_sessions");
  });
});

describe("a practitioner's first year", () => {
  it("says nothing to somebody who has not started", () => {
    expect(earnedByPractitioner(NO_PRACTITIONER)).toEqual([]);
  });

  it("marks a booking, then the session it became", () => {
    expect(earnedByPractitioner({ ...NO_PRACTITIONER, bookingsMade: 1 })).toEqual([
      "pro_first_booking",
    ]);

    const held = earnedByPractitioner({ ...NO_PRACTITIONER, bookingsMade: 1, sessionsHeld: 1 });
    expect(held).toContain("pro_first_session");
  });

  /**
   * The practitioner's answer to the host's first payout: the moment somebody
   * stops searching and starts having a routine. Two sessions in two different
   * rooms is still shopping.
   */
  it("marks going back to the same room, not merely booking twice", () => {
    const twoRooms = earnedByPractitioner({
      ...NO_PRACTITIONER,
      bookingsMade: 2,
      sessionsHeld: 2,
      roomsUsed: 2,
      roomsReturnedTo: 0,
    });
    expect(twoRooms).not.toContain("pro_first_repeat");

    const sameRoom = earnedByPractitioner({
      ...NO_PRACTITIONER,
      bookingsMade: 2,
      sessionsHeld: 2,
      roomsUsed: 1,
      roomsReturnedTo: 1,
    });
    expect(sameRoom).toContain("pro_first_repeat");
  });
});

/**
 * Recognition only. badges.ts records what happened when tiers carried real
 * benefits — a longer window, a waived fee, a faster payout — and every one
 * became a rule to reason about while somebody was booking. Nothing here may
 * grow into that, so nothing here names a price, a limit or a fee.
 */
describe("what a milestone is allowed to be", () => {
  it("promises nothing about money, limits or priority", () => {
    for (const m of MILESTONES) {
      const words = `${m.title} ${m.meaning}`.toLowerCase();
      for (const forbidden of ["discount", "free", "fee", "priority", "unlock", "%", "off"]) {
        expect(words, `${m.key} says "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  /**
   * If everything is a celebration then nothing is. One per side, and it is
   * the one where something actually happened rather than was arranged.
   */
  it("interrupts somebody exactly once per side", () => {
    for (const party of ["host", "practitioner"] as const) {
      const loud = MILESTONES.filter((m) => m.party === party && m.celebrate);
      expect(loud, `${party} celebrations`).toHaveLength(1);
      expect(loud[0].key).toContain("first_session");
    }
  });

  it("gives every milestone a meaning, not just a count", () => {
    for (const m of MILESTONES) {
      expect(m.meaning.length, m.key).toBeGreaterThan(20);
      expect(m.title.length, m.key).toBeGreaterThan(5);
    }
  });

  it("has no duplicate keys, since the key is what gets stored", () => {
    expect(new Set(MILESTONES.map((m) => m.key)).size).toBe(MILESTONES.length);
  });

  it("refuses a key it does not know rather than returning something empty", () => {
    expect(() => milestone("nope" as never)).toThrow(RangeError);
  });
});

describe("interrupting somebody", () => {
  it("does not interrupt when there is nothing new", () => {
    expect(celebrationDue(["host_listed", "host_first_booking"], [])).toBeNull();
  });

  it("interrupts on the first session", () => {
    const due = celebrationDue(["host_listed", "host_first_session"], ["host_listed"]);
    expect(due?.key).toBe("host_first_session");
  });

  /** Once seen, never again — the stored key is what stops it repeating. */
  it("does not interrupt twice for the same moment", () => {
    expect(celebrationDue(["host_first_session"], ["host_first_session"])).toBeNull();
  });

  it("works the same on the practitioner side", () => {
    expect(celebrationDue(["pro_first_session"], [])?.key).toBe("pro_first_session");
  });
});

/**
 * The one place symmetry is deliberately broken.
 *
 * A host's payoff is money arriving; a practitioner's outlay is money leaving.
 * Congratulating somebody on having spent two thousand dollars is showing them
 * a bill, so the practitioner's total counts practice rather than spend.
 */
describe("the running total", () => {
  it("tells a host what the empty hours earned", () => {
    expect(hostTotal({ ...NO_HOST, sessionsHosted: 40, earnedCents: 180000 })).toBe(
      "40 hours you were not using, turned into $1,800.",
    );
  });

  it("counts one hour as one", () => {
    expect(hostTotal({ ...NO_HOST, sessionsHosted: 1, earnedCents: 4500 })).toBe(
      "1 hour you were not using, turned into $45.",
    );
  });

  it("tells a practitioner what they held, never what they spent", () => {
    const total = practitionerTotal({ ...NO_PRACTITIONER, sessionsHeld: 40, roomsUsed: 6 });

    expect(total).toBe("40 sessions held, in 6 rooms.");
    expect(total).not.toMatch(/\$|spent|paid/);
  });

  it("says nothing at all before there is anything to say", () => {
    expect(hostTotal(NO_HOST)).toBeNull();
    expect(practitionerTotal(NO_PRACTITIONER)).toBeNull();
  });
});
