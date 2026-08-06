import { describe, expect, it } from "vitest";

import {
  type CancellationEvent,
  type Party,
  STANDING_WINDOW_DAYS,
  SUSPENSION_DAYS,
  explainStanding,
  isLate,
  standingFor,
} from "./reliability";

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

    const expected = new Date(daysAgo(1).getTime() + SUSPENSION_DAYS * 86_400_000);
    expect(standing.suspendedUntil?.getTime()).toBe(expected.getTime());
  });
});

describe("practitioners, whose late cancellation is already paid for", () => {
  it("does not suspend at three, because the host was made whole", () => {
    const standing = standingFor("practitioner", lateRun("practitioner", 3), NOW);

    expect(standing.blocksNewBookings).toBe(false);
  });

  it("suspends at six, catching a pattern rather than a loss", () => {
    const standing = standingFor("practitioner", lateRun("practitioner", 6), NOW);

    expect(standing.level).toBe("suspended");
    expect(standing.blocksNewBookings).toBe(true);
  });

  it("holds hosts to a stricter line than practitioners", () => {
    const four = 4;
    expect(standingFor("host", lateRun("host", four), NOW).blocksNewBookings).toBe(true);
    expect(
      standingFor("practitioner", lateRun("practitioner", four), NOW).blocksNewBookings,
    ).toBe(false);
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

    expect(message).toMatch(/contact us/i);
  });

  it("thanks someone with a clean record rather than saying nothing", () => {
    const message = explainStanding("host", standingFor("host", [], NOW));

    expect(message).toMatch(/no last-minute cancellations/i);
  });
});
