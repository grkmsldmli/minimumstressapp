import { describe, expect, it } from "vitest";

import { hostFactsFrom, practitionerFactsFrom } from "./milestone-facts";
import type { Booking, HostBooking, HostSpace } from "./domain";

/**
 * Which field means "it happened".
 *
 * A milestone announcing a session nobody held is worse than no milestone, so
 * these pin the counts to the rows that prove the thing rather than the rows
 * that merely mention it.
 */
const space = (over: Partial<HostSpace> = {}) =>
  ({ id: "s1", status: "active", reviewCount: 0, ...over }) as HostSpace;

const hostBooking = (over: Partial<HostBooking> = {}) =>
  ({ id: "b1", spaceId: "s1", status: "completed", netCents: 4500, ...over }) as HostBooking;

const booking = (over: Partial<Booking> = {}) =>
  ({ id: "b1", spaceId: "s1", status: "completed", ...over }) as Booking;

describe("what a host's numbers are read from", () => {
  it("counts only listings that are actually on the map", () => {
    const facts = hostFactsFrom({
      spaces: [space(), space({ id: "s2", status: "pending" }), space({ id: "s3", status: "delisted" })],
      bookings: [],
      payoutsReceived: 0,
    });

    expect(facts.liveListings).toBe(1);
  });

  /**
   * "Somebody chose your room" happened even if they later cancelled. The
   * milestone is about being chosen, not about the session going ahead — that
   * is the next one along.
   */
  it("keeps a cancelled booking as a booking, but not as a session", () => {
    const facts = hostFactsFrom({
      spaces: [space()],
      bookings: [hostBooking(), hostBooking({ id: "b2", status: "cancelled_by_practitioner" })],
      payoutsReceived: 0,
    });

    expect(facts.bookingsReceived).toBe(2);
    expect(facts.sessionsHosted).toBe(1);
  });

  it("earns from sessions held, never from ones cancelled", () => {
    const facts = hostFactsFrom({
      spaces: [space()],
      bookings: [
        hostBooking({ netCents: 4500 }),
        hostBooking({ id: "b2", netCents: 5500 }),
        hostBooking({ id: "b3", status: "cancelled_by_host", netCents: 9900 }),
      ],
      payoutsReceived: 0,
    });

    expect(facts.earnedCents).toBe(10000);
  });

  it("adds up reviews across every room they run", () => {
    const facts = hostFactsFrom({
      spaces: [space({ reviewCount: 3 }), space({ id: "s2", reviewCount: 2 })],
      bookings: [],
      payoutsReceived: 0,
    });

    expect(facts.reviewsReceived).toBe(5);
  });
});

describe("what a practitioner's numbers are read from", () => {
  it("separates rooms used from rooms returned to", () => {
    const facts = practitionerFactsFrom({
      bookings: [
        booking({ id: "a", spaceId: "s1" }),
        booking({ id: "b", spaceId: "s1" }),
        booking({ id: "c", spaceId: "s2" }),
      ],
      reviewsReceived: 0,
    });

    expect(facts.sessionsHeld).toBe(3);
    expect(facts.roomsUsed).toBe(2);
    expect(facts.roomsReturnedTo).toBe(1);
  });

  /**
   * Booking the same room twice and cancelling one is still a search. Going
   * back is about having been there twice, not about having meant to.
   */
  it("does not count a cancelled second visit as going back", () => {
    const facts = practitionerFactsFrom({
      bookings: [
        booking({ id: "a", spaceId: "s1" }),
        booking({ id: "b", spaceId: "s1", status: "cancelled_by_practitioner" }),
      ],
      reviewsReceived: 0,
    });

    expect(facts.roomsReturnedTo).toBe(0);
    expect(facts.bookingsMade).toBe(2);
    expect(facts.sessionsHeld).toBe(1);
  });

  it("counts nothing from an empty history", () => {
    const facts = practitionerFactsFrom({ bookings: [], reviewsReceived: 0 });

    expect(facts).toEqual({
      bookingsMade: 0,
      sessionsHeld: 0,
      reviewsReceived: 0,
      roomsUsed: 0,
      roomsReturnedTo: 0,
    });
  });
});
