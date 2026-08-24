import { describe, expect, it } from "vitest";

import { FREE_CANCEL_WINDOW_MS, isFreeCancellation, resolveCancellation } from "./money";
import {
  type CancellationEvent,
  type Party,
  LATE_CANCELLATION_HOURS,
  STANDING_WINDOW_DAYS,
  SUSPENSION_DAYS,
  countsTowardStanding,
  explainStanding,
  isLate,
  standingFor,
  toCancellationEvents,
} from "./reliability";

/** A $40 room at the standard fee, for the cancellation checks. */
const MONEY = {
  hostRateCents: 4000,
  serviceFeeCents: 800,
  instantFeeCents: 0,
  proDiscountCents: 0,
  totalCents: 4800,
  platformCents: 800,
};

const NOW = new Date(2026, 7, 3, 12, 0, 0);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** A cancellation `days` ago, `hoursAhead` before the session it killed. */
function cancellation(by: Party, days: number, hoursAhead = 2): CancellationEvent {
  const at = daysAgo(days);
  return { by, at, sessionStart: new Date(at.getTime() + hoursAhead * 3_600_000) };
}

const lateRun = (by: Party, count: number, spacingDays = 5) =>
  Array.from({ length: count }, (_, i) => cancellation(by, (i + 1) * spacingDays));

describe("what counts as late", () => {
  it("counts a cancellation inside 24 hours", () => {
    expect(isLate(cancellation("host", 1, 2))).toBe(true);
    expect(isLate(cancellation("host", 1, 23))).toBe(true);
  });

  it("does not count one made in good time", () => {
    // The same boundary the refund policy uses, so there is one line to learn.
    expect(isLate(cancellation("host", 1, 25))).toBe(false);
    expect(isLate(cancellation("host", 1, 72))).toBe(false);
  });
});

describe("hosts, where the harm is not settled by money", () => {
  it("says nothing after one — things genuinely happen", () => {
    const standing = standingFor("host", lateRun("host", 1), NOW);

    expect(standing.level).toBe("clear");
    expect(standing.blocksNewBookings).toBe(false);
  });

  it("warns at two, while there is still something to do about it", () => {
    const standing = standingFor("host", lateRun("host", 2), NOW);

    expect(standing.level).toBe("warned");
    expect(standing.remainingBeforeSuspension).toBe(1);
    expect(standing.blocksNewBookings).toBe(false);
  });

  it("suspends at three", () => {
    const standing = standingFor("host", lateRun("host", 3), NOW);

    expect(standing.level).toBe("suspended");
    expect(standing.blocksNewBookings).toBe(true);
    expect(standing.suspendedUntil).not.toBeNull();
  });

  it("lifts on its own once served", () => {
    // Third cancellation 20 days ago, suspension runs 14.
    const history = [
      cancellation("host", 40),
      cancellation("host", 30),
      cancellation("host", 20),
    ];
    const standing = standingFor("host", history, NOW);

    expect(standing.blocksNewBookings).toBe(false);
    // Still on record until it ages out, so the warning is honest.
    expect(standing.level).toBe("warned");
  });

  it("starts the clock at the cancellation, not at whenever someone looks", () => {
    const history = lateRun("host", 3, 1); // 1, 2 and 3 days ago
    const standing = standingFor("host", history, NOW);

    const expected = new Date(daysAgo(1).getTime() + SUSPENSION_DAYS.host * 86_400_000);
    expect(standing.suspendedUntil?.getTime()).toBe(expected.getTime());
  });
});

describe("practitioners, paused on the same count but for less time", () => {
  it("does not pause under three", () => {
    // CASE B/C: one and two late cancellations do not block a booking.
    expect(standingFor("practitioner", lateRun("practitioner", 1), NOW).blocksNewBookings).toBe(
      false,
    );
    expect(standingFor("practitioner", lateRun("practitioner", 2), NOW).blocksNewBookings).toBe(
      false,
    );
  });

  it("warns at two, one short of the pause", () => {
    const standing = standingFor("practitioner", lateRun("practitioner", 2), NOW);

    expect(standing.level).toBe("warned");
    expect(standing.remainingBeforeSuspension).toBe(1);
  });

  it("pauses at three, the same count as a host", () => {
    // CASE D: three qualifying late cancellations in the window blocks new bookings.
    const standing = standingFor("practitioner", lateRun("practitioner", 3), NOW);

    expect(standing.level).toBe("suspended");
    expect(standing.blocksNewBookings).toBe(true);
    expect(standing.suspendedUntil).not.toBeNull();
  });

  it("serves a shorter pause than a host does, from the same trigger", () => {
    // CASE I: the same three cancellations on both sides; only the length differs.
    const days = (by: Party) => lateRun(by, 3, 1); // 1, 2 and 3 days ago
    const trigger = daysAgo(1).getTime(); // the third cancellation, sorted
    const host = standingFor("host", days("host"), NOW);
    const practitioner = standingFor("practitioner", days("practitioner"), NOW);

    expect(host.suspendedUntil?.getTime()).toBe(trigger + SUSPENSION_DAYS.host * 86_400_000);
    expect(practitioner.suspendedUntil?.getTime()).toBe(
      trigger + SUSPENSION_DAYS.practitioner * 86_400_000,
    );
    expect(practitioner.suspendedUntil!.getTime()).toBeLessThan(host.suspendedUntil!.getTime());
  });

  it("does not count the other side's cancellations against a practitioner", () => {
    // CASE F: five late host cancellations plus two of the practitioner's own is
    // still under three for the practitioner — a host's cancellation is not theirs.
    const history = [...lateRun("host", 5), ...lateRun("practitioner", 2)];

    expect(standingFor("practitioner", history, NOW).blocksNewBookings).toBe(false);
  });
});

describe("the window", () => {
  it("stops counting cancellations older than the window", () => {
    const old = [
      cancellation("host", STANDING_WINDOW_DAYS + 10),
      cancellation("host", STANDING_WINDOW_DAYS + 5),
      cancellation("host", STANDING_WINDOW_DAYS + 1),
    ];
    const standing = standingFor("host", old, NOW);

    expect(standing.lateCancellations).toBe(0);
    expect(standing.level).toBe("clear");
  });

  it("restores someone as their history ages out, with nobody having to act", () => {
    const mixed = [
      cancellation("host", STANDING_WINDOW_DAYS + 1), // expired
      cancellation("host", 10),
      cancellation("host", 5),
    ];
    const standing = standingFor("host", mixed, NOW);

    expect(standing.lateCancellations).toBe(2);
    expect(standing.blocksNewBookings).toBe(false);
  });
});

describe("counting only what belongs to this person", () => {
  it("ignores the other side's cancellations", () => {
    const history = [...lateRun("practitioner", 5), ...lateRun("host", 1)];

    expect(standingFor("host", history, NOW).lateCancellations).toBe(1);
  });

  it("ignores cancellations made in good time", () => {
    const inGoodTime = Array.from({ length: 5 }, (_, i) => cancellation("host", i + 1, 48));

    expect(standingFor("host", inGoodTime, NOW).lateCancellations).toBe(0);
  });
});

describe("appeals", () => {
  it("clears everything before a staff reinstatement", () => {
    // An automatic rule with no way to be heard is a trapdoor, not a policy.
    const history = lateRun("host", 4);
    const reinstated = daysAgo(3);

    const standing = standingFor("host", history, NOW, reinstated);

    expect(standing.lateCancellations).toBe(0);
    expect(standing.blocksNewBookings).toBe(false);
  });

  it("still counts what happened after one", () => {
    const history = [...lateRun("host", 3, 10), cancellation("host", 1)];
    const standing = standingFor("host", history, NOW, daysAgo(5));

    expect(standing.lateCancellations).toBe(1);
  });
});

describe("what the person is told", () => {
  it("says plainly that one more will stop their bookings", () => {
    const standing = standingFor("host", lateRun("host", 2), NOW);
    const message = explainStanding("host", standing);

    expect(message).toContain("One more");
    expect(message).toMatch(/won't be able to take/);
  });

  it("promises that booked sessions still go ahead", () => {
    // A suspension that cancelled existing bookings would land on a third
    // party who did nothing — the harm this policy exists to prevent.
    const message = explainStanding("host", standingFor("host", lateRun("host", 3), NOW));

    expect(message).toMatch(/already booked go ahead/i);
  });

  it("offers a way to contest it", () => {
    // A rule with nobody to ask is one somebody's livelihood ends on with no
    // recourse. Matched on substance, so rewording it does not fail here.
    const message = explainStanding("host", standingFor("host", lateRun("host", 3), NOW));

    expect(message).toMatch(/@minimumstress\.com/i);
  });

  it("thanks someone with a clean record rather than saying nothing", () => {
    const message = explainStanding("host", standingFor("host", [], NOW));

    expect(message).toMatch(/no last-minute cancellations/i);
  });
});

/**
 * Which cancellations are even eligible to count, before standing does its sums.
 *
 * The blocker this guards: an abandoned checkout is released by the reaper as a
 * `cancelled_by = practitioner` cancellation with no `captured_at`, and once
 * standing became a real booking restriction, counting those would suspend
 * somebody for closing a card form. `captured_at` — written only by payment
 * success — is the line, and it lives in `countsTowardStanding` /
 * `toCancellationEvents` so the card, the server gate and the admin watchlist
 * all apply it identically.
 */
describe("which cancellations count toward standing", () => {
  /** A cancelled-booking row as the client/server/admin read it before mapping. */
  const row = (
    over: Partial<{
      cancelledBy: string | null;
      capturedAt: Date | null;
      cancelledAt: Date | null;
      sessionStart: Date;
    }> = {},
  ) => {
    const at = daysAgo(5);
    return {
      cancelledBy: "practitioner" as string | null,
      capturedAt: at as Date | null, // money arrived = a genuine, held booking
      cancelledAt: at as Date | null,
      sessionStart: new Date(at.getTime() + 2 * 3_600_000), // 2h after = late
      ...over,
    };
  };

  /** A genuine, captured, late practitioner cancellation `days` ago. */
  const genuine = (days: number) => {
    const at = daysAgo(days);
    return {
      cancelledBy: "practitioner" as string | null,
      capturedAt: at as Date | null,
      cancelledAt: at as Date | null,
      sessionStart: new Date(at.getTime() + 2 * 3_600_000),
    };
  };

  it("A: counts an explicit practitioner cancellation inside 24h", () => {
    const events = toCancellationEvents([row()]);
    expect(events).toHaveLength(1);
    expect(standingFor("practitioner", events, NOW).lateCancellations).toBe(1);
  });

  it("B: keeps a genuine cancellation made in good time, but standing does not count it", () => {
    const early = row({ sessionStart: new Date(daysAgo(5).getTime() + 48 * 3_600_000) });
    const events = toCancellationEvents([early]);
    expect(events).toHaveLength(1); // it was a real booking they cancelled
    expect(standingFor("practitioner", events, NOW).lateCancellations).toBe(0); // just not late
  });

  it("C: does not count a host cancellation against a practitioner", () => {
    const events = toCancellationEvents([row({ cancelledBy: "host" })]);
    expect(standingFor("practitioner", events, NOW).lateCancellations).toBe(0);
  });

  it("D: does not count an abandoned checkout (released with no capture)", () => {
    // The reaper writes cancelled_by = practitioner with captured_at null.
    expect(countsTowardStanding({ cancelledBy: "practitioner", capturedAt: null })).toBe(false);
    expect(toCancellationEvents([row({ capturedAt: null })])).toEqual([]);
  });

  it("E: does not count a system/platform release with no capture", () => {
    // A Stripe-expired intent or any automatic cleanup: same shape, no capture.
    expect(toCancellationEvents([row({ capturedAt: null, cancelledBy: "practitioner" })])).toEqual(
      [],
    );
  });

  it("F: pauses on three genuine qualifying cancellations in 90 days", () => {
    const events = toCancellationEvents([genuine(5), genuine(10), genuine(15)]);
    expect(events).toHaveLength(3);
    expect(standingFor("practitioner", events, NOW).blocksNewBookings).toBe(true);
  });

  it("G: two genuine cancellations plus one abandoned checkout still allow booking", () => {
    const abandoned = { ...genuine(15), capturedAt: null };
    const events = toCancellationEvents([genuine(5), genuine(10), abandoned]);
    expect(events).toHaveLength(2); // the abandoned one dropped out
    expect(standingFor("practitioner", events, NOW).blocksNewBookings).toBe(false);
  });

  it("H: the card and the gate build the same count from the same rows", () => {
    // Both the client history and the server gate map through this one function,
    // so identical rows give an identical count and an identical decision.
    const rows = [genuine(5), genuine(10), genuine(15), { ...genuine(20), capturedAt: null }];
    const events = toCancellationEvents(rows);
    const standing = standingFor("practitioner", events, NOW);
    expect(events).toHaveLength(3); // abandoned dropped, three genuine remain
    expect(standing.blocksNewBookings).toBe(true);
  });

  it("accepts database timestamps as strings, not only Date objects", () => {
    // The real repositories hand this ISO strings straight from the row.
    const at = daysAgo(5);
    const events = toCancellationEvents([
      {
        cancelledBy: "practitioner",
        capturedAt: at.toISOString(),
        cancelledAt: at.toISOString(),
        sessionStart: new Date(at.getTime() + 2 * 3_600_000).toISOString(),
      },
    ]);
    expect(events).toHaveLength(1);
    expect(standingFor("practitioner", events, NOW).lateCancellations).toBe(1);
  });
});

/**
 * One line, not two numbers that happen to match.
 *
 * The refund window and the standing window were separate constants, both 24,
 * with a comment saying they were the same boundary. Changing either would
 * have left the app charging for a cancellation it did not count against
 * anybody, or counting one it did not charge for — and nothing would have
 * failed.
 */
describe("the 24-hour line", () => {
  it("is the same line for money and for standing", () => {
    expect(LATE_CANCELLATION_HOURS * 60 * 60 * 1000).toBe(FREE_CANCEL_WINDOW_MS);
  });

  it("charges and counts on the same side of it", () => {
    const sessionStart = new Date("2026-08-10T12:00:00Z");
    const justInside = new Date(sessionStart.getTime() - FREE_CANCEL_WINDOW_MS + 60_000);
    const justOutside = new Date(sessionStart.getTime() - FREE_CANCEL_WINDOW_MS - 60_000);

    // Inside: money is taken, and it counts.
    expect(isFreeCancellation(sessionStart, justInside)).toBe(false);
    expect(
      resolveCancellation(MONEY, "practitioner", sessionStart, justInside).action,
    ).toBe("capture_full");

    // Outside: nothing is taken, and nothing counts.
    expect(isFreeCancellation(sessionStart, justOutside)).toBe(true);
    expect(
      resolveCancellation(MONEY, "practitioner", sessionStart, justOutside).action,
    ).toBe("void");
  });
});
