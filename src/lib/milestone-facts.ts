import type { Booking, HostBooking, HostSpace } from "./domain";
import type { HostFacts, PractitionerFacts } from "./milestones";

/**
 * The counts a milestone is decided from, read off rows the app already holds.
 *
 * Kept apart from milestones.ts so the rules there stay arithmetic over plain
 * numbers and can be tested without inventing a booking. This file is the only
 * place that knows which field means "it happened", and it is worth stating
 * why each one is the field chosen.
 *
 * Nothing here counts an hour somebody held and walked away from. Both sides
 * already exclude those before the app sees them — `host_bookings()` requires
 * `captured_at`, and `listMyBookings` drops an uncaptured `upcoming` row —
 * but the rule is repeated in the shape of these counts rather than assumed,
 * because a milestone announcing a session that never happened is worse than
 * no milestone at all.
 */

/** A session that happened: it ran, and the money moved. */
function held(status: string): boolean {
  return status === "completed";
}

export function hostFactsFrom(input: {
  spaces: readonly HostSpace[];
  bookings: readonly HostBooking[];
  /** Whether a payout has actually reached the bank, not merely been queued. */
  payoutsReceived: number;
}): HostFacts {
  const sessions = input.bookings.filter((b) => held(b.status));

  return {
    /*
     * Live, not merely created. A listing waiting for review is not on the map
     * and telling somebody it is would send them to check.
     */
    liveListings: input.spaces.filter((s) => s.status === "active").length,

    /*
     * Every booking that reached this list, including ones later cancelled.
     * Somebody did choose the room, and that moment happened whatever became
     * of it — the milestone says "somebody chose your room", not "and came".
     */
    bookingsReceived: input.bookings.length,

    sessionsHosted: sessions.length,

    /*
     * Reviews across all of their rooms. reviewCount on a space is released
     * reviews only, which is the same thing a practitioner sees.
     */
    reviewsReceived: input.spaces.reduce((sum, s) => sum + s.reviewCount, 0),

    payoutsReceived: input.payoutsReceived,

    // The host's own rate, which is all of what they are owed. netCents is
    // already exactly that — the platform's cut is not theirs to see.
    earnedCents: sessions.reduce((sum, b) => sum + b.netCents, 0),
  };
}

export function practitionerFactsFrom(input: {
  bookings: readonly Booking[];
  /** Reviews a practitioner has received, which studios write about them. */
  reviewsReceived: number;
}): PractitionerFacts {
  const sessions = input.bookings.filter((b) => held(b.status));

  /*
   * Rooms used, and rooms used more than once.
   *
   * The second is the practitioner's answer to a host's first payout: the
   * moment somebody stops shopping and starts having a routine. Counted from
   * sessions actually held rather than bookings made, so two bookings of the
   * same room where one was cancelled is still a search.
   */
  const perRoom = new Map<string, number>();
  for (const session of sessions) {
    perRoom.set(session.spaceId, (perRoom.get(session.spaceId) ?? 0) + 1);
  }

  return {
    bookingsMade: input.bookings.length,
    sessionsHeld: sessions.length,
    reviewsReceived: input.reviewsReceived,
    roomsUsed: perRoom.size,
    roomsReturnedTo: [...perRoom.values()].filter((n) => n > 1).length,
  };
}
