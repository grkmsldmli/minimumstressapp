import { describe, expect, it } from "vitest";

import { standingFor, toCancellationEvents } from "../reliability";
import {
  LIVE_LEAD_MS,
  LIVE_TRAIL_MS,
  type PaidBooking,
  buildActivity,
  rollUp,
  sessionState,
  standingByPerson,
} from "./queue";

/**
 * The operator screen turns numbers back into names, and this is the part that
 * decides whose name. Money on the wrong row is worse than no number at all:
 * it is wrong with the same confidence as it would be right, and somebody
 * would act on it before doubting it.
 */

const HOSTS = new Map([
  ["room-1", "host-a"],
  ["room-2", "host-a"],
  ["room-3", "host-b"],
]);

const booking = (over: Partial<PaidBooking> = {}): PaidBooking => ({
  spaceId: "room-1",
  practitionerId: "practitioner-1",
  hostRateCents: 4500,
  totalCents: 5400,
  ...over,
});

describe("rollUp", () => {
  it("pays the host their rate and charges the practitioner the total", () => {
    const { perPerson } = rollUp([booking()], HOSTS);

    expect(perPerson.get("host-a")).toEqual({ sessions: 1, earned: 4500, spent: 0 });
    expect(perPerson.get("practitioner-1")).toEqual({ sessions: 1, earned: 0, spent: 5400 });
  });

  /**
   * The gap between the two is the platform's fee. Summing the columns would
   * count one session's revenue twice, which is the mistake this separation
   * exists to make impossible.
   */
  it("never gives the host the practitioner's fees", () => {
    const { perPerson } = rollUp([booking({ hostRateCents: 4500, totalCents: 5400 })], HOSTS);

    expect(perPerson.get("host-a")!.earned).toBe(4500);
    expect(perPerson.get("host-a")!.spent).toBe(0);
  });

  it("adds up rooms belonging to the same host", () => {
    const { perPerson, perListing } = rollUp(
      [
        booking({ spaceId: "room-1", hostRateCents: 4500 }),
        booking({ spaceId: "room-2", hostRateCents: 6000 }),
      ],
      HOSTS,
    );

    expect(perPerson.get("host-a")).toEqual({ sessions: 2, earned: 10500, spent: 0 });
    expect(perListing.get("room-1")!.earned).toBe(4500);
    expect(perListing.get("room-2")!.earned).toBe(6000);
  });

  it("keeps two hosts apart", () => {
    const { perPerson } = rollUp(
      [booking({ spaceId: "room-1" }), booking({ spaceId: "room-3" })],
      HOSTS,
    );

    expect(perPerson.get("host-a")!.sessions).toBe(1);
    expect(perPerson.get("host-b")!.sessions).toBe(1);
  });

  /** One session, however many roles one person played in it. */
  it("counts a host booking their own room once", () => {
    const { perPerson } = rollUp([booking({ practitionerId: "host-a" })], HOSTS);

    expect(perPerson.get("host-a")!.sessions).toBe(1);
    expect(perPerson.get("host-a")!.earned).toBe(4500);
    expect(perPerson.get("host-a")!.spent).toBe(5400);
  });

  it("still counts the room when the host has since been removed", () => {
    const { perPerson, perListing } = rollUp([booking({ spaceId: "room-gone" })], HOSTS);

    expect(perListing.get("room-gone")!.sessions).toBe(1);
    expect(perPerson.has("host-a")).toBe(false);
    // The practitioner paid regardless of what happened to the other side.
    expect(perPerson.get("practitioner-1")!.spent).toBe(5400);
  });

  it("survives a booking with no practitioner on it", () => {
    const { perPerson } = rollUp([booking({ practitionerId: null })], HOSTS);

    expect(perPerson.get("host-a")!.sessions).toBe(1);
    expect(perPerson.size).toBe(1);
  });

  it("has nothing to say about a marketplace with no paid bookings", () => {
    const { perPerson, perListing } = rollUp([], HOSTS);

    expect(perPerson.size).toBe(0);
    expect(perListing.size).toBe(0);
  });

  /**
   * Whatever else moves, the platform's cut is what is left over. If the two
   * columns ever drift, this is the assertion that fails first.
   */
  it("leaves the platform exactly the difference across many bookings", () => {
    const bookings = Array.from({ length: 25 }, (_, index) =>
      booking({
        spaceId: index % 2 === 0 ? "room-1" : "room-3",
        practitionerId: `practitioner-${index % 4}`,
        hostRateCents: 3000 + index * 100,
        totalCents: Math.round((3000 + index * 100) * 1.2),
      }),
    );

    const { perPerson } = rollUp(bookings, HOSTS);

    const earned = [...perPerson.values()].reduce((sum, t) => sum + t.earned, 0);
    const spent = [...perPerson.values()].reduce((sum, t) => sum + t.spent, 0);
    const expected = bookings.reduce((sum, b) => sum + (b.totalCents - b.hostRateCents), 0);

    expect(spent - earned).toBe(expected);
  });
});

describe("sessionState", () => {
  const NOW = new Date("2026-08-11T18:00:00Z");
  const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

  /** Session 17:00-18:00, so `now` is the moment it ends. */
  const at = (startHoursFromNow: number, status = "upcoming") =>
    sessionState(status, hours(startHoursFromNow), hours(startHoursFromNow + 1), NOW);

  it("names which side of the hour a session is on", () => {
    expect(at(-0.5)).toBe("in progress");
    expect(at(1)).toBe("starting soon");
    expect(at(-2)).toBe("just finished");
  });

  it("reaches two hours ahead and no further", () => {
    expect(at(LIVE_LEAD_MS / 3_600_000)).toBe("starting soon");
    expect(at(LIVE_LEAD_MS / 3_600_000 + 0.01)).toBeNull();
  });

  it("keeps a finished session reachable for two hours", () => {
    // Ends three hours ago: exactly the trailing edge, since the session runs
    // an hour and the window is measured from its end.
    expect(at(-1 - LIVE_TRAIL_MS / 3_600_000)).toBe("just finished");
    expect(at(-1.01 - LIVE_TRAIL_MS / 3_600_000)).toBeNull();
  });

  /**
   * Nobody is in that room. Listing it would send somebody looking for a person
   * who never came, which is worse than an empty panel.
   */
  it("leaves out sessions nobody is attending", () => {
    expect(at(-0.5, "cancelled_by_practitioner")).toBeNull();
    expect(at(-0.5, "cancelled_by_host")).toBeNull();
    expect(at(-0.5, "no_show")).toBeNull();
  });

  it("keeps a completed session, which is how a past hour is recorded", () => {
    expect(at(-1.5, "completed")).toBe("just finished");
  });
});

/**
 * The feed a person reads to decide whether the marketplace is working.
 *
 * It had no test at all, and it was counting held hours as bookings. An
 * abandoned checkout sits at `upcoming` with no `captured_at` until the sweep
 * reaches it, and it appeared here as "— booked" — the exact failure
 * abandoned.ts predicted when it named who pays for the leftovers: "The
 * operator's numbers lie. Booked this month counts money that was never
 * taken."
 */
describe("the activity feed", () => {
  const spaceName = new Map([["space-1", "Reformer Hit"]]);

  const feed = (rows: Record<string, unknown>[]) =>
    buildActivity({
      rows,
      spaceName,
      spaces: [],
      profiles: [],
      reviews: [],
      messages: [],
      emails: new Map(),
    });

  const booking = (over: Record<string, unknown> = {}) => ({
    id: "b1",
    space_id: "space-1",
    status: "upcoming",
    starts_at: "2026-09-01T17:00:00Z",
    captured_at: "2026-08-20T10:00:00Z",
    ...over,
  });

  it("reports a paid booking", () => {
    expect(feed([booking()]).map((e) => e.text)).toEqual(["Reformer Hit — booked"]);
  });

  it("says nothing about an hour somebody held and never paid for", () => {
    expect(feed([booking({ captured_at: null })])).toEqual([]);
  });

  /**
   * A cancelled row is a thing that happened to somebody, and this feed is a
   * history rather than a ledger — so it stays whatever its money did.
   */
  it("keeps a cancellation whether or not it was ever paid", () => {
    const texts = feed([
      booking({ id: "b1", status: "cancelled_by_practitioner", cancelled_at: "2026-08-21T10:00:00Z" }),
      booking({ id: "b2", status: "cancelled_by_host", captured_at: null, cancelled_at: "2026-08-22T10:00:00Z" }),
    ]).map((e) => e.text);

    expect(texts).toContain("Reformer Hit — cancelled by the practitioner");
    expect(texts).toContain("Reformer Hit — cancelled by the studio");
  });

  it("does not drop a completed session", () => {
    expect(feed([booking({ status: "completed" })])).toHaveLength(1);
  });
});

/**
 * The watchlist counts exactly what standing counts.
 *
 * standingByPerson is the operator screen's "who is at risk", and the point of
 * these is that it applies the same three qualifications the booking gate and
 * the profile card apply — captured, own side, and inside the 24-hour window —
 * rather than a separate approximation. An early cancellation or an abandoned
 * checkout must not put somebody on this list, because it does not pause them.
 */
describe("standingByPerson — the watchlist uses the real standing rule", () => {
  const spaceHost = new Map([["room-1", "host-a"]]);
  const NOW = new Date("2026-08-24T12:00:00Z");
  const dAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  /** A cancelled-booking row as the admin query returns it. */
  const cancel = (opts: {
    role?: "practitioner" | "host";
    days: number;
    aheadHours?: number; // session start this many hours after the cancellation; <24 = late
    captured?: boolean; // default true
  }) => {
    const cancelledAt = dAgo(opts.days);
    return {
      status: opts.role === "host" ? "cancelled_by_host" : "cancelled_by_practitioner",
      space_id: "room-1",
      practitioner_id: "pr-1",
      captured_at: (opts.captured ?? true) ? cancelledAt.toISOString() : null,
      cancelled_at: cancelledAt.toISOString(),
      starts_at: new Date(cancelledAt.getTime() + (opts.aheadHours ?? 2) * 3_600_000).toISOString(),
    };
  };

  it("A: two genuine late practitioner cancellations show a warning", () => {
    const s = standingByPerson([cancel({ days: 5 }), cancel({ days: 10 })], spaceHost, NOW);
    const pr = s.get("pr-1")!;
    expect(pr.role).toBe("practitioner");
    expect(pr.standing.lateCancellations).toBe(2);
    expect(pr.standing.level).toBe("warned");
    expect(pr.standing.blocksNewBookings).toBe(false);
  });

  it("B: two cancellations made in good time raise no warning", () => {
    const s = standingByPerson(
      [cancel({ days: 5, aheadHours: 48 }), cancel({ days: 10, aheadHours: 48 })],
      spaceHost,
      NOW,
    );
    expect(s.get("pr-1")!.standing.lateCancellations).toBe(0);
    expect(s.get("pr-1")!.standing.level).toBe("clear");
  });

  it("C: one late plus one early counts as a single qualifying cancellation", () => {
    const s = standingByPerson(
      [cancel({ days: 5 }), cancel({ days: 10, aheadHours: 48 })],
      spaceHost,
      NOW,
    );
    expect(s.get("pr-1")!.standing.lateCancellations).toBe(1);
    expect(s.get("pr-1")!.standing.level).toBe("clear"); // one is below the warn bar of two
  });

  it("D: two late plus one abandoned checkout stays at two, not three", () => {
    const s = standingByPerson(
      [cancel({ days: 5 }), cancel({ days: 10 }), cancel({ days: 15, captured: false })],
      spaceHost,
      NOW,
    );
    expect(s.get("pr-1")!.standing.lateCancellations).toBe(2);
    expect(s.get("pr-1")!.standing.level).toBe("warned");
    expect(s.get("pr-1")!.standing.blocksNewBookings).toBe(false);
  });

  it("E: a host cancellation counts against the host, never the practitioner", () => {
    const s = standingByPerson([cancel({ role: "host", days: 5 })], spaceHost, NOW);
    expect(s.get("pr-1")).toBeUndefined();
    const host = s.get("host-a")!;
    expect(host.role).toBe("host");
    expect(host.standing.lateCancellations).toBe(1);
  });

  it("F: pauses a practitioner at three genuine late cancellations", () => {
    const s = standingByPerson(
      [cancel({ days: 5 }), cancel({ days: 10 }), cancel({ days: 15 })],
      spaceHost,
      NOW,
    );
    expect(s.get("pr-1")!.standing.lateCancellations).toBe(3);
    expect(s.get("pr-1")!.standing.blocksNewBookings).toBe(true);
  });

  it("G: the same rows give card, gate, and admin the same count and state", () => {
    // One fixture, read three ways. The client history and the server booking
    // facts both map rows through toCancellationEvents then standingFor; the
    // admin does the same inside standingByPerson. Same input, same standing —
    // and the abandoned checkout drops out of all three alike.
    const rows = [cancel({ days: 5 }), cancel({ days: 10 }), cancel({ days: 15, captured: false })];

    // Exactly what SupabaseRepository.listCancellationHistory (the card) and
    // gatherBookingFacts (the gate) build from these rows.
    const events = toCancellationEvents(
      rows.map((r) => ({
        cancelledBy: r.status === "cancelled_by_host" ? "host" : "practitioner",
        capturedAt: r.captured_at,
        cancelledAt: r.cancelled_at,
        sessionStart: r.starts_at,
      })),
    );
    const cardAndGate = standingFor("practitioner", events, NOW);
    const admin = standingByPerson(rows, spaceHost, NOW).get("pr-1")!.standing;

    expect(admin.lateCancellations).toBe(cardAndGate.lateCancellations);
    expect(admin.blocksNewBookings).toBe(cardAndGate.blocksNewBookings);
    expect(admin.level).toBe(cardAndGate.level);
    expect(cardAndGate.lateCancellations).toBe(2); // abandoned checkout excluded everywhere
  });

  it("keeps the host rule unchanged: warned at two, paused at three", () => {
    const two = standingByPerson(
      [cancel({ role: "host", days: 5 }), cancel({ role: "host", days: 10 })],
      spaceHost,
      NOW,
    );
    expect(two.get("host-a")!.standing.level).toBe("warned");
    expect(two.get("host-a")!.standing.blocksNewBookings).toBe(false);

    const three = standingByPerson(
      [
        cancel({ role: "host", days: 5 }),
        cancel({ role: "host", days: 10 }),
        cancel({ role: "host", days: 15 }),
      ],
      spaceHost,
      NOW,
    );
    expect(three.get("host-a")!.standing.blocksNewBookings).toBe(true);
  });
});
