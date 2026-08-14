import { describe, expect, it } from "vitest";

import {
  CLAIM_CAP_CENTS,
  claimBlockedBecause,
  explainClaimBlock,
  CLAIM_TYPES,
  CLAIM_WINDOW_HOURS,
  CLEANING_FEE_CENTS,
  type ClaimContext,
  claimType,
  overstayCents,
  routeClaim,
} from "./claims";

const NOW = new Date("2026-08-10T18:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

const claim = (over: Partial<ClaimContext> = {}): ClaimContext => ({
  kind: "cleaning",
  sessionEnd: hoursAgo(2),
  now: NOW,
  hourlyRateCents: 4000,
  minutesOver: 0,
  claimedCents: null,
  hasPhoto: true,
  ...over,
});

describe("nothing is charged on a description", () => {
  /**
   * The mirror of the refund rule. A studio's word alone must not reach
   * somebody's card any more than a practitioner's word alone reaches a
   * studio's balance.
   */
  it("closes a claim that needs a photograph and has none", () => {
    for (const type of CLAIM_TYPES.filter((t) => t.requiresPhoto)) {
      const route = routeClaim(claim({ kind: type.kind, hasPhoto: false }));
      expect(route.kind, type.kind).toBe("closed");
    }
  });

  /** Time over the hour is a clock reading, not something a picture shows. */
  it("does not demand one for time over the hour", () => {
    const route = routeClaim(claim({ kind: "overstay", minutesOver: 20, hasPhoto: false }));
    expect(route.kind).toBe("priced");
  });

  /**
   * "Priced" is not "paid". The best a claim can do on arrival is name a
   * figure both sides can see — the practitioner still answers and a person
   * still decides.
   */
  it("never reaches a state that means money moved", () => {
    const kinds = ["priced", "assess", "closed"];
    for (const type of CLAIM_TYPES) {
      const route = routeClaim(claim({ kind: type.kind, minutesOver: 30, claimedCents: 5000 }));
      expect(kinds).toContain(route.kind);
    }
  });
});

describe("the window", () => {
  it("closes after two days", () => {
    const route = routeClaim(claim({ sessionEnd: hoursAgo(CLAIM_WINDOW_HOURS + 1) }));

    expect(route.kind).toBe("closed");
    if (route.kind === "closed") expect(route.because).toMatch(/other people have used/);
  });

  it("is open right up to it", () => {
    expect(routeClaim(claim({ sessionEnd: hoursAgo(CLAIM_WINDOW_HOURS) })).kind).toBe("priced");
  });

  /** A session that has not happened cannot have been damaged during it. */
  it("refuses a session still in the future", () => {
    const route = routeClaim(claim({ sessionEnd: new Date(NOW.getTime() + 60 * 60 * 1000) }));
    expect(route.kind).toBe("closed");
  });
});

describe("what a clean costs", () => {
  it("is the same published figure for every studio", () => {
    const cheap = routeClaim(claim({ hourlyRateCents: 2500 }));
    const dear = routeClaim(claim({ hourlyRateCents: 12000 }));

    expect(cheap).toEqual(dear);
    if (cheap.kind === "priced") expect(cheap.amountCents).toBe(CLEANING_FEE_CENTS);
  });
});

describe("time over the hour", () => {
  /**
   * Priced from the room rather than a flat figure. The same twenty minutes
   * costs an $80 studio more than a $35 one, and one number would be wrong for
   * both of them.
   */
  it("follows the room's own rate", () => {
    expect(overstayCents(30, 4000)).toBe(2000);
    expect(overstayCents(30, 8000)).toBe(4000);
  });

  /**
   * Rounded up, because that is how the loss lands: ten minutes over is what
   * stops the next booking starting on time, and ten minutes' worth would not
   * cover it.
   */
  it("rounds up to the half hour", () => {
    expect(overstayCents(1, 4000)).toBe(2000);
    expect(overstayCents(31, 4000)).toBe(4000);
    expect(overstayCents(60, 4000)).toBe(4000);
  });

  it("charges nothing for no overrun", () => {
    expect(overstayCents(0, 4000)).toBe(0);
    expect(overstayCents(-10, 4000)).toBe(0);
  });

  /** A host reporting somebody as eight hours late cannot invoice a day. */
  it("stops at four hours however long they claim", () => {
    expect(overstayCents(600, 4000)).toBe(overstayCents(240, 4000));
    expect(overstayCents(600, 4000)).toBe(16000);
  });

  it("closes a claim with no time in it", () => {
    expect(routeClaim(claim({ kind: "overstay", minutesOver: 0 })).kind).toBe("closed");
  });
});

describe("real damage", () => {
  it("goes to a person for a number", () => {
    const route = routeClaim(claim({ kind: "damage", claimedCents: 12000 }));
    expect(route.kind).toBe("assess");
  });

  /**
   * Above the cap we stop being the ones who decide. A marketplace that
   * quietly becomes an insurer has taken on a liability nobody priced.
   */
  it("hands anything above the cap to insurance", () => {
    const route = routeClaim(claim({ kind: "damage", claimedCents: CLAIM_CAP_CENTS + 1 }));

    expect(route.kind).toBe("closed");
    if (route.kind === "closed") expect(route.because).toMatch(/insurance/);
  });

  it("still handles a claim right on the cap", () => {
    expect(routeClaim(claim({ kind: "damage", claimedCents: CLAIM_CAP_CENTS })).kind).toBe("assess");
  });
});

describe("the claim types themselves", () => {
  it("asks something real after each one", () => {
    for (const type of CLAIM_TYPES) {
      expect(type.prompt.length, type.kind).toBeGreaterThan(20);
      expect(type.label.length, type.kind).toBeGreaterThan(5);
    }
  });

  it("prices the repeatable ones and assesses the rest", () => {
    expect(claimType("cleaning").fixedCents).toBe(CLEANING_FEE_CENTS);
    expect(claimType("damage").fixedCents).toBeNull();
  });
});

/**
 * Whether there is a session here to claim against at all.
 *
 * The payment test used to read `stripe_payment_intent_id`, which is written
 * when the row is created and stays there after the sweep cancels the intent.
 * So an abandoned checkout — an hour nobody paid for and nobody entered —
 * passed it, and a practitioner could be told they had damaged a room they had
 * never been inside. No money would have moved, because Stripe refuses a
 * cancelled intent, but that is the wrong place to be caught.
 */
describe("whether a booking can be claimed against", () => {
  const paid = { status: "completed", capturedAt: new Date("2026-08-20T10:00:00Z") };

  it("allows a completed session that was paid for", () => {
    expect(claimBlockedBecause(paid)).toBeNull();
  });

  /**
   * A cancelled session can still be claimed against — a host who cleaned up
   * after a no-show is out the same money as one who cleaned up after a guest.
   */
  it.each(["cancelled_by_practitioner", "cancelled_by_host"])(
    "allows a paid booking that was %s",
    (status) => {
      expect(claimBlockedBecause({ ...paid, status })).toBeNull();
    },
  );

  it("refuses a session that has not happened", () => {
    expect(claimBlockedBecause({ ...paid, status: "upcoming" })).toBe("not_yet");
  });

  it("refuses an hour that was never paid for", () => {
    expect(claimBlockedBecause({ ...paid, capturedAt: null })).toBe("never_paid");
  });

  /** The abandoned checkout exactly: reaped to cancelled, never captured. */
  it("refuses an abandoned checkout the sweep has cancelled", () => {
    expect(
      claimBlockedBecause({ status: "cancelled_by_practitioner", capturedAt: null }),
    ).toBe("never_paid");
  });

  it("says why, in words a host can act on", () => {
    expect(explainClaimBlock("not_yet").message).toMatch(/has not happened/i);
    expect(explainClaimBlock("never_paid").message).toMatch(/never paid/i);
    expect(explainClaimBlock("never_paid").status).toBe(409);
  });
});
