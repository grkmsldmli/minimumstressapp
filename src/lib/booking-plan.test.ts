import { describe, expect, it } from "vitest";

import {
  explainRejection,
  planBooking,
  planSeries,
  type HostFacts,
  type PractitionerFacts,
  type SpaceFacts,
} from "./booking-plan";
import {
  BOOKING_HORIZON_DAYS,
  INSTANT_FEE_CENTS,
  MAX_UPCOMING_BOOKINGS_FREE,
  PRO_BOOKING_HORIZON_DAYS,
} from "./money";
import { addDays, instantFrom } from "./timezone";

/**
 * A Monday at 10:00 in the room's own city, with the room open 09:00-17:00
 * every weekday.
 *
 * The zone is named rather than inherited from the test runner. `planBooking`
 * runs on a server in UTC while the times it judges were chosen on a phone
 * somewhere else, so a fixture built from the ambient zone would only ever
 * prove that the runner agrees with itself.
 */
const ZONE = "America/Los_Angeles";
const MONDAY = { year: 2026, month: 8, day: 3 };

const at = (hour: number, dayOffset = 0): Date => {
  const instant = instantFrom(addDays(MONDAY, dayOffset), hour * 60, ZONE);
  if (!instant) throw new Error(`${hour}:00 does not exist on that day`);
  return instant;
};

const NOW = at(10);

const SPACE: SpaceFacts = {
  id: "sp_1",
  hostId: "host_1",
  hourlyRateCents: 4500,
  bufferMinutes: 0,
  capacity: 8,
  allowedUses: [],
  bookingMode: "instant" as const,
  status: "active",
  timeZone: ZONE,
  availability: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  })),
};

const HOST: HostFacts = { stripeAccountId: "acct_1", payable: true };
const PRACTITIONER: PractitionerFacts = {
  id: "pr_1",
  isPro: false,
  accountType: "practitioner",
  // Verified, so the tests about price, horizon and availability are not
  // tripped by the identity gate they were not written to examine. The gate's
  // own behaviour is covered in its own case below.
  identityVerified: true,
  /*
   * Verified cover on a wide-open window, so the tests about price, horizon and
   * availability are not tripped by the eligibility gate they were not written
   * to examine. The gate's own behaviour is exhausted in insurance.test.ts and
   * in the CASE A–N block at the foot of this file.
   */
  insurance: {
    hasCertificate: true,
    state: "verified",
    effectiveDate: new Date("2025-01-01T00:00:00Z"),
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  },
  // A declared profession with verified proof, so the tests about price, horizon
  // and availability are not tripped by the credential gate they were not
  // written to examine. Pilates, so the default booking is not forced through
  // host approval the way massage is; the gate's own behaviour has its own cases.
  profession: "pilates",
  credentialVerified: true,
};

const plan = (overrides: Partial<Parameters<typeof planBooking>[0]> = {}) =>
  planBooking({
    space: SPACE,
    host: HOST,
    practitioner: PRACTITIONER,
    takenStarts: [],
    startsAt: at(14),
    now: NOW,
    /*
     * Every booking declares what it is for, so the default here does too.
     * These tests are about price, horizon and availability; a test that
     * omitted the declaration would be failing for a reason it was not written
     * to examine. The declaration's own rules are in booking-use.test.ts.
     */
    declared: { purpose: "movement_session", attendees: 1 },
    ...overrides,
  });

describe("the price comes from the space, never the request", () => {
  it("prices from the host's stored rate", () => {
    const result = plan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.money.hostRateCents).toBe(4500);
    expect(result.money.totalCents).toBe(5400);
  });

  it("follows the rate when the host changes it, with no input from the caller", () => {
    const result = plan({ space: { ...SPACE, hourlyRateCents: 8000 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.money.hostRateCents).toBe(8000);
    expect(result.money.totalCents).toBe(9600);
  });

  /**
   * Pro is still read from the stored profile rather than the request, and it
   * still has to be — it decides how far ahead somebody may book and how many
   * sessions they may hold, both of which a caller would happily claim.
   */
  it("prices a Pro account exactly like any other", () => {
    const standard = plan();
    const pro = plan({ practitioner: { ...PRACTITIONER, isPro: true } });

    expect(standard.ok && standard.money.totalCents).toBe(5400);
    expect(pro.ok && pro.money.totalCents).toBe(5400);
    expect(pro.ok && pro.money.proDiscountCents).toBe(0);
  });

  it("derives instant from the clock, not from a flag on the request", () => {
    const soon = plan({ startsAt: at(11) }); // one hour out
    const later = plan({ startsAt: at(15) }); // five hours out

    expect(soon.ok && soon.isInstant).toBe(true);
    expect(soon.ok && soon.money.instantFeeCents).toBe(INSTANT_FEE_CENTS);
    expect(later.ok && later.isInstant).toBe(false);
    expect(later.ok && later.money.instantFeeCents).toBe(0);
  });


  it("pays the host their full rate however the rest of it moves", () => {
    for (const isPro of [false, true]) {
      for (const hour of [11, 14]) {
        const result = plan({
          practitioner: { ...PRACTITIONER, isPro },
          startsAt: at(hour),
        });
        expect(result.ok && result.money.hostRateCents).toBe(4500);
      }
    }
  });
});

describe("a slot has to be one the host actually opened", () => {
  it("refuses an hour outside the day's blocks", () => {
    // 20:00 is still ahead of us but well past the 17:00 close, so it reaches
    // the availability check rather than being caught as already past.
    expect(plan({ startsAt: at(20) })).toEqual({ ok: false, reason: "slot_not_open" });
  });

  it("refuses a day the host is closed", () => {
    // Saturday. Inside the horizon now that everyone sees the week, so the
    // only thing left refusing it is the schedule — which is what this is for.
    const saturday = new Date(2026, 7, 8, 14, 0, 0);
    expect(plan({ startsAt: saturday })).toMatchObject({ reason: "slot_not_open" });
  });

  it("refuses a half-hour start even inside an open block", () => {
    const halfPast = new Date(2026, 7, 3, 14, 30, 0);
    expect(plan({ startsAt: halfPast })).toEqual({ ok: false, reason: "slot_not_open" });
  });

  it("refuses an hour whose session would overrun the block with its buffer", () => {
    // 16:00 plus a 60-minute session plus 30 minutes turnover passes 17:00.
    const result = plan({
      space: { ...SPACE, bufferMinutes: 30 },
      startsAt: at(16),
    });
    expect(result).toEqual({ ok: false, reason: "slot_not_open" });
  });

  it("refuses a time that has already passed", () => {
    expect(plan({ startsAt: at(9) })).toEqual({ ok: false, reason: "slot_in_past" });
  });

  it("refuses an hour someone else already took", () => {
    expect(plan({ takenStarts: [at(14)] })).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("allows the same hour on a space where it is not taken", () => {
    expect(plan({ takenStarts: [at(15)] }).ok).toBe(true);
  });
});

/**
 * The horizon stopped being a tier.
 *
 * It was same-day unless you paid, which made a host open on Tuesdays and
 * Fridays invisible to a free account five days out of seven.
 *
 * How far it reaches is set by the card hold, not chosen — see
 * BOOKING_HORIZON_DAYS. Written against the constant here for the same reason
 * it is derived there: the previous version of these tests named seven days,
 * which was the figure the money could not actually collect.
 */
describe("the booking horizon", () => {
  /*
   * The room here opens weekdays only, so the furthest day inside the window is
   * not necessarily a day it is open. Walking to the nearest open one keeps
   * these tests measuring the horizon rather than the calendar — otherwise a
   * horizon landing on a Saturday would "fail" for the wrong reason.
   */
  const isOpen = (dayOffset: number) => {
    const weekday = (1 + dayOffset) % 7; // BASE is a Monday.
    return weekday >= 1 && weekday <= 5;
  };

  const lastOpenInside = (() => {
    for (let day = BOOKING_HORIZON_DAYS; day > 0; day -= 1) if (isOpen(day)) return day;
    throw new Error("no open day inside the horizon");
  })();

  const firstOpenOutside = (() => {
    for (let day = BOOKING_HORIZON_DAYS + 1; day < BOOKING_HORIZON_DAYS + 8; day += 1) {
      if (isOpen(day)) return day;
    }
    throw new Error("no open day beyond the horizon");
  })();

  it("lets anybody reach the far end of it", () => {
    expect(plan({ startsAt: at(14, lastOpenInside) }).ok).toBe(true);
  });

  it("no longer holds a free account to today", () => {
    expect(plan({ startsAt: at(14, 1) }).ok).toBe(true);
  });

  it("gives Pro no further reach, because there is nothing further to give", () => {
    const free = plan({ startsAt: at(14, lastOpenInside) });
    const pro = plan({
      practitioner: { ...PRACTITIONER, isPro: true },
      startsAt: at(14, lastOpenInside),
    });
    expect(free.ok).toBe(true);
    expect(pro.ok).toBe(free.ok);
  });

  /**
   * How far a room can honestly be promised, and nothing to do with payment any
   * more — the money is taken at booking, so nothing expires while a booking
   * waits. See BOOKING_HORIZON_DAYS.
   */
  it("stops a free account past the end of its window", () => {
    // Open, so the only thing refusing it is the horizon.
    expect(plan({ startsAt: at(14, firstOpenOutside) })).toEqual({
      ok: false,
      reason: "beyond_booking_horizon",
    });
  });

  /** The same day, reachable on Pro. Room to plan a term, nothing hidden. */
  it("lets Pro reach a day a free account cannot", () => {
    const pro = plan({
      practitioner: { ...PRACTITIONER, isPro: true },
      startsAt: at(14, firstOpenOutside),
    });

    expect(pro.ok).toBe(true);
  });

  it("stops Pro at thirty days", () => {
    const beyondPro = PRO_BOOKING_HORIZON_DAYS + 2;

    expect(
      plan({ practitioner: { ...PRACTITIONER, isPro: true }, startsAt: at(14, beyondPro) }),
    ).toEqual({ ok: false, reason: "beyond_booking_horizon" });
  });
});

describe("refusing to take money nobody can receive", () => {
  it("refuses when the host has no connected account", () => {
    expect(plan({ host: { stripeAccountId: null, payable: false } })).toEqual({
      ok: false,
      reason: "host_cannot_be_paid",
    });
  });

  it("refuses when onboarding was started but never finished", () => {
    // Someone can abandon Stripe's hosted form halfway; the account exists
    // and cannot be paid.
    expect(plan({ host: { stripeAccountId: "acct_1", payable: false } })).toEqual({
      ok: false,
      reason: "host_cannot_be_paid",
    });
  });

  it("refuses a listing still awaiting review", () => {
    expect(plan({ space: { ...SPACE, status: "pending" } })).toEqual({
      ok: false,
      reason: "space_not_active",
    });
  });

  it("refuses a delisted space", () => {
    expect(plan({ space: { ...SPACE, status: "delisted" } })).toEqual({
      ok: false,
      reason: "space_not_active",
    });
  });

  it("refuses a space that does not exist", () => {
    expect(plan({ space: null })).toEqual({ ok: false, reason: "space_not_found" });
  });
});

/**
 * What Pro sells now that it no longer sells the schedule.
 *
 * Hiding hours broke the app for somebody who had never booked at all. A cap
 * on how many run at once is invisible until somebody is already getting real
 * use out of the marketplace — and that person is the one for whom the fee
 * waiver and the 10% already pay for the subscription several times over.
 */
describe("how many sessions can be held at once", () => {
  it("lets a free account book while under the limit", () => {
    expect(plan({ upcomingCount: MAX_UPCOMING_BOOKINGS_FREE - 1 }).ok).toBe(true);
  });

  it("refuses a free account at the limit", () => {
    expect(plan({ upcomingCount: MAX_UPCOMING_BOOKINGS_FREE })).toEqual({
      ok: false,
      reason: "too_many_upcoming",
    });
  });

  it("never refuses Pro for this", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, isPro: true },
      upcomingCount: MAX_UPCOMING_BOOKINGS_FREE * 10,
    });
    expect(result.ok).toBe(true);
  });

  /**
   * Checked before the slot, so the answer does not depend on which room was
   * tapped. Somebody at their limit is at their limit everywhere.
   */
  it("says so before complaining about the hour", () => {
    const closed = new Date(2026, 7, 8, 14, 0, 0);
    expect(plan({ upcomingCount: MAX_UPCOMING_BOOKINGS_FREE, startsAt: closed })).toEqual({
      ok: false,
      reason: "too_many_upcoming",
    });
  });

  it("tells somebody what to do about it", () => {
    const { message } = explainRejection("too_many_upcoming");
    expect(message).toContain(String(MAX_UPCOMING_BOOKINGS_FREE));
    expect(message).toMatch(/pro/i);
  });

  /** A cap on what is held at once, not on how much anybody may use this. */
  it("counts sessions ahead rather than sessions ever booked", () => {
    expect(plan({ upcomingCount: 0 }).ok).toBe(true);
  });
});

/**
 * The declaration, where it meets the rest of the plan.
 *
 * booking-use.test.ts covers the rule itself. What is checked here is that the
 * plan asks it at all, that it asks last, and that a host who reviews requests
 * gets a plan that says so.
 */
describe("what the room is for", () => {
  it("refuses a booking that declares nothing", () => {
    expect(plan({ declared: null })).toEqual({ ok: false, reason: "purpose_missing" });
  });

  it("refuses a use the host does not offer", () => {
    const strict = { ...SPACE, allowedUses: ["movement_session"] };
    expect(plan({ space: strict, declared: { purpose: "filming", attendees: 2 } })).toEqual({
      ok: false,
      reason: "use_not_allowed",
    });
  });

  it("refuses more people than the room takes", () => {
    const small = { ...SPACE, capacity: 4 };
    expect(plan({ space: small, declared: { purpose: "group_class", attendees: 9 } })).toEqual({
      ok: false,
      reason: "too_many_attendees",
    });
  });

  /*
   * Asked after availability, so somebody who picked an hour that is already
   * taken is told that rather than being asked to justify a booking they were
   * never going to get.
   */
  it("says the hour is taken before it asks what the hour is for", () => {
    expect(plan({ takenStarts: [at(14)], declared: null })).toEqual({
      ok: false,
      reason: "slot_taken",
    });
  });

  it("marks a booking on a request-to-book listing as needing approval", () => {
    const byRequest = { ...SPACE, bookingMode: "request" as const };
    const result = plan({ space: byRequest });
    expect(result.ok && result.needsApproval).toBe(true);
  });

  it("does not, on an instant listing", () => {
    const result = plan();
    expect(result.ok && result.needsApproval).toBe(false);
  });

  /** A listing that predates the question keeps working. */
  it("allows anything while the host has not chosen", () => {
    const result = plan({ declared: { purpose: "filming", attendees: 2 } });
    expect(result.ok).toBe(true);
  });
});

/*
 * Professional-only booking + liability insurance, run through the real gate.
 *
 * These are the spec's CASE A–N. The point of running them through planBooking
 * rather than checkInsuranceForBooking directly is that planBooking is the one
 * gate every caller crosses — the form, the API route and the recurring
 * expander all end here — so a case that passes here cannot be bypassed by
 * hitting the endpoint another way (CASE I). Browsing (CASE A) never reaches
 * this function and so is never gated; the read paths do not call it.
 */
describe("who may confirm a booking, and with what cover (CASE A–N)", () => {
  const NON_PRO_DATE = at(14, 1); // Tue Aug 4, comfortably inside the 14-day horizon
  const activeInsurance = PRACTITIONER.insurance;

  // Live now, but a short window: valid today, lapses in two days.
  const shortWindow = {
    hasCertificate: true,
    state: "verified" as const,
    effectiveDate: new Date("2026-08-01T00:00:00Z"),
    expiresAt: new Date("2026-08-05T00:00:00Z"),
  };

  // CASE H — an account that never chose the professional side has no
  // professional profile to book against, and is refused before insurance is
  // even considered.
  it("H: refuses an account with no professional profile", () => {
    expect(plan({ practitioner: { ...PRACTITIONER, accountType: null } })).toEqual({
      ok: false,
      reason: "professional_profile_required",
    });
  });

  it("H: refuses a host trying to book like a guest", () => {
    expect(plan({ practitioner: { ...PRACTITIONER, accountType: "host" } })).toEqual({
      ok: false,
      reason: "professional_profile_required",
    });
  });

  // Identity — an unverified practitioner cannot confirm a new booking, and is
  // refused before cover is even considered. Server-authoritative: this reads
  // the stored flag the Stripe Identity webhook sets, never anything the client
  // asserts.
  it("refuses a practitioner whose identity is not verified", () => {
    expect(plan({ practitioner: { ...PRACTITIONER, identityVerified: false } })).toEqual({
      ok: false,
      reason: "identity_verification_required",
    });
  });

  it("refuses an unverified identity even with verified cover (identity is checked first)", () => {
    expect(
      plan({
        practitioner: { ...PRACTITIONER, identityVerified: false, insurance: activeInsurance },
      }),
    ).toEqual({ ok: false, reason: "identity_verification_required" });
  });

  it("gives the identity refusal a sentence and a 403", () => {
    const { message, status } = explainRejection("identity_verification_required");
    expect(message.length).toBeGreaterThan(20);
    expect(message.toLowerCase()).toContain("identity");
    expect(status).toBe(403);
  });

  // CASE — professional proof, which every profession must provide. The default
  // practitioner has verified identity and cover, so these isolate the credential
  // gate. credentialVerified is the single staff-written boolean it reads; false
  // stands for pending and rejected alike.
  it("refuses massage without a verified credential", () => {
    expect(
      plan({ practitioner: { ...PRACTITIONER, profession: "massage", credentialVerified: false } }),
    ).toEqual({ ok: false, reason: "credential_required" });
  });

  it("refuses any other profession without verified proof (pilates)", () => {
    expect(
      plan({ practitioner: { ...PRACTITIONER, profession: "pilates", credentialVerified: false } }),
    ).toEqual({ ok: false, reason: "credential_required" });
  });

  it("requires proof even when no profession is chosen", () => {
    expect(
      plan({ practitioner: { ...PRACTITIONER, profession: null, credentialVerified: false } }),
    ).toEqual({ ok: false, reason: "credential_required" });
  });

  it("lets a non-massage profession through once proof is verified, instant if the space allows", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, profession: "pilates", credentialVerified: true },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.needsApproval).toBe(false);
  });

  it("lets massage through with a verified credential, but always via host approval", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, profession: "massage", credentialVerified: true },
    });
    // Instant space, yet massage still needs the host to say yes.
    expect(result.ok).toBe(true);
    expect(result.ok && result.needsApproval).toBe(true);
  });

  it("does not force approval for a non-massage use of a space, whatever it is called", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, profession: "movement", credentialVerified: true },
    });
    expect(result.ok && result.needsApproval).toBe(false);
  });

  it("checks the credential after identity and insurance, not before", () => {
    // A massage practitioner who is also unverified fails on identity first —
    // the credential gate never masks the earlier, cheaper checks.
    expect(
      plan({
        practitioner: {
          ...PRACTITIONER,
          identityVerified: false,
          profession: "massage",
          credentialVerified: false,
        },
      }),
    ).toEqual({ ok: false, reason: "identity_verification_required" });
  });

  it("gives the credential refusal a sentence and a 403", () => {
    const { message, status } = explainRejection("credential_required");
    expect(message.length).toBeGreaterThan(20);
    expect(status).toBe(403);
  });

  // CASE B — a professional who never added cover cannot confirm.
  it("B: refuses a professional with no certificate on file", () => {
    expect(
      plan({
        practitioner: {
          ...PRACTITIONER,
          insurance: { hasCertificate: false, state: "pending", effectiveDate: null, expiresAt: null },
        },
      }),
    ).toEqual({ ok: false, reason: "insurance_required" });
  });

  // CASE C — a certificate uploaded but not yet reviewed is not cover.
  it("C: refuses while the certificate is still being reviewed", () => {
    expect(
      plan({
        practitioner: {
          ...PRACTITIONER,
          insurance: { hasCertificate: true, state: "pending", effectiveDate: null, expiresAt: null },
        },
      }),
    ).toEqual({ ok: false, reason: "insurance_pending" });
  });

  // CASE N — a certificate staff turned down is not cover.
  it("N: refuses a rejected certificate", () => {
    expect(
      plan({
        practitioner: {
          ...PRACTITIONER,
          insurance: { hasCertificate: true, state: "rejected", effectiveDate: null, expiresAt: null },
        },
      }),
    ).toEqual({ ok: false, reason: "insurance_rejected" });
  });

  // CASE D — verified cover, valid on the date, goes through.
  it("D: allows a professional with verified, active cover", () => {
    const result = plan({
      practitioner: { ...PRACTITIONER, insurance: activeInsurance },
      startsAt: NON_PRO_DATE,
    });
    expect(result.ok).toBe(true);
  });

  // CASE E — cover that has already lapsed is refused outright.
  it("E: refuses cover that has already expired", () => {
    expect(
      plan({
        practitioner: {
          ...PRACTITIONER,
          insurance: {
            hasCertificate: true,
            state: "verified",
            effectiveDate: new Date("2025-01-01T00:00:00Z"),
            expiresAt: new Date("2026-07-01T00:00:00Z"), // before NOW (Aug 3)
          },
        },
        startsAt: NON_PRO_DATE,
      }),
    ).toEqual({ ok: false, reason: "insurance_expired" });
  });

  // CASE F — cover live today, but the booking is past the window's end.
  it("F: refuses a future booking the live cover does not reach", () => {
    expect(
      plan({
        practitioner: { ...PRACTITIONER, insurance: shortWindow },
        startsAt: at(14, 7), // Mon Aug 10, past the Aug 5 expiry, still within horizon
      }),
    ).toEqual({ ok: false, reason: "insurance_not_valid_for_date" });
  });

  // CASE G — a recurring series is only as good as its furthest date. Each
  // occurrence is its own check against the same window: the early ones pass,
  // and the one past expiry is refused rather than silently created.
  it("G: covers the early dates of a series and refuses the one past expiry", () => {
    const covered = plan({
      practitioner: { ...PRACTITIONER, insurance: shortWindow },
      startsAt: at(14, 1), // Aug 4, inside the window
    });
    const uncovered = plan({
      practitioner: { ...PRACTITIONER, insurance: shortWindow },
      startsAt: at(14, 7), // Aug 10, past the window
    });
    expect(covered.ok).toBe(true);
    expect(uncovered).toEqual({ ok: false, reason: "insurance_not_valid_for_date" });
  });

  // CASE L — a 1:1 client session is ordinary professional use.
  it("L: allows a verified professional's 1:1 client session", () => {
    const result = plan({
      startsAt: NON_PRO_DATE,
      declared: { purpose: "client_session", attendees: 1 },
    });
    expect(result.ok).toBe(true);
  });

  // CASE K — a group class is allowed where the host permits it and it fits.
  it("K: allows a group class the host offers and the room fits", () => {
    const result = plan({
      space: { ...SPACE, allowedUses: ["group_class"], capacity: 8 },
      startsAt: NON_PRO_DATE,
      declared: { purpose: "group_class", attendees: 6 },
    });
    expect(result.ok).toBe(true);
  });

  // CASE M — so is a workshop, on the same terms.
  it("M: allows a workshop the host offers and the room fits", () => {
    const result = plan({
      space: { ...SPACE, allowedUses: ["workshop"], capacity: 12 },
      startsAt: NON_PRO_DATE,
      declared: { purpose: "workshop", attendees: 10 },
    });
    expect(result.ok).toBe(true);
  });

  // The host's own permission still governs: insurance is not a skeleton key.
  it("still refuses a group class a host did not offer", () => {
    expect(
      plan({
        space: { ...SPACE, allowedUses: ["client_session"] },
        startsAt: NON_PRO_DATE,
        declared: { purpose: "group_class", attendees: 6 },
      }),
    ).toEqual({ ok: false, reason: "use_not_allowed" });
  });

  // The professional gate is asked before the slot, so eligibility does not
  // depend on which hour was tapped (CASE I: no ordering makes it bypassable).
  it("I: refuses on eligibility before it looks at the slot at all", () => {
    expect(
      plan({
        practitioner: { ...PRACTITIONER, accountType: null },
        startsAt: at(3, 1), // 03:00, an hour the room never opens
      }),
    ).toEqual({ ok: false, reason: "professional_profile_required" });
  });

  /*
   * The whole session, not just the day it starts. Cover that ends on the
   * booking day covers a 14:00 hour, whose 15:00 end is still that day — but not
   * a 16:00 hour, whose 17:00 PT end is 00:00 UTC the next day, past the window.
   * Same policy, same day, different hour: only the interval check tells them
   * apart, and this is the case behind "cover the entire booking interval".
   */
  it("refuses when the session's END falls past cover, though its start is within", () => {
    const expiresOnBookingDay = {
      ...PRACTITIONER,
      insurance: {
        hasCertificate: true,
        state: "verified" as const,
        effectiveDate: new Date("2026-08-01T00:00:00Z"),
        expiresAt: new Date("2026-08-03T00:00:00Z"), // the booking day itself
      },
    };
    // 16:00 PT runs to 17:00 PT = 2026-08-04T00:00Z, one moment past the window.
    expect(plan({ practitioner: expiresOnBookingDay, startsAt: at(16) })).toEqual({
      ok: false,
      reason: "insurance_not_valid_for_date",
    });
    // The same cover holds an earlier hour whose end stays inside the day.
    expect(plan({ practitioner: expiresOnBookingDay, startsAt: at(14) }).ok).toBe(true);
  });
});

/*
 * A standing pause, run through the real gate.
 *
 * Until now the pause was display-only: standingFor computed blocksNewBookings
 * and the profile showed it, but no booking path consulted it, so a paused
 * practitioner could book from the sheet or straight from the API. planBooking
 * is the one gate every caller crosses, so enforcing it here is what makes the
 * pause real and un-bypassable — the same argument the CASE I test makes for
 * eligibility. It stops NEW bookings only; nothing here cancels an existing one.
 */
describe("a standing pause stops a new booking, and only a new one", () => {
  const daysBeforeNow = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
  // A late cancellation `days` ago: the session it killed was two hours later,
  // so it lands inside the 24-hour "late" line.
  const lateCancel = (days: number, by: "host" | "practitioner" = "practitioner") => {
    const at = daysBeforeNow(days);
    return { by, at, sessionStart: new Date(at.getTime() + 2 * 3_600_000) };
  };

  it("A: allows a booking with no cancellations", () => {
    expect(plan({ practitionerCancellations: [] }).ok).toBe(true);
  });

  it("B: allows a booking after one late cancellation", () => {
    expect(plan({ practitionerCancellations: [lateCancel(5)] }).ok).toBe(true);
  });

  it("C: allows a booking after two late cancellations", () => {
    expect(plan({ practitionerCancellations: [lateCancel(5), lateCancel(10)] }).ok).toBe(true);
  });

  it("D: refuses a booking at three late cancellations inside the window", () => {
    expect(
      plan({ practitionerCancellations: [lateCancel(5), lateCancel(10), lateCancel(15)] }),
    ).toEqual({ ok: false, reason: "standing_paused" });
  });

  it("E: does not count a cancellation that has aged out of the window", () => {
    // Two inside 90 days, one just past it — only two count, so the booking stands.
    expect(
      plan({
        practitionerCancellations: [lateCancel(5), lateCancel(10), lateCancel(95)],
      }).ok,
    ).toBe(true);
  });

  it("F: does not count the host's cancellations against the practitioner", () => {
    // Five late host cancellations and two of the practitioner's own: under three.
    expect(
      plan({
        practitionerCancellations: [
          lateCancel(3, "host"),
          lateCancel(6, "host"),
          lateCancel(9, "host"),
          lateCancel(12, "host"),
          lateCancel(15, "host"),
          lateCancel(20),
          lateCancel(25),
        ],
      }).ok,
    ).toBe(true);
  });

  it("does not count a cancellation made in good time", () => {
    // Three cancellations, but each was made 48 hours ahead — none is late.
    const inGoodTime = [3, 6, 9].map((days) => {
      const at = daysBeforeNow(days);
      return {
        by: "practitioner" as const,
        at,
        sessionStart: new Date(at.getTime() + 48 * 3_600_000),
      };
    });
    expect(plan({ practitionerCancellations: inGoodTime }).ok).toBe(true);
  });

  it("K: refuses at the gate every caller crosses, so a direct API call cannot bypass it", () => {
    // planBooking is what createBooking and the route both call; a pause here is
    // a pause everywhere, whatever slot is asked for.
    expect(
      plan({
        practitionerCancellations: [lateCancel(1), lateCancel(2), lateCancel(3)],
        startsAt: at(15),
      }),
    ).toEqual({ ok: false, reason: "standing_paused" });
  });

  it("checks the pause before the slot, so eligibility does not depend on the hour", () => {
    expect(
      plan({
        practitionerCancellations: [lateCancel(1), lateCancel(2), lateCancel(3)],
        startsAt: at(3, 1), // 03:00, an hour the room never opens
      }),
    ).toEqual({ ok: false, reason: "standing_paused" });
  });

  it("L: says so plainly, at 409, and that existing bookings are unaffected", () => {
    const { message, status } = explainRejection("standing_paused");
    expect(status).toBe(409);
    expect(message).toMatch(/paused/i);
    expect(message).toMatch(/existing bookings/i);
  });
});

/*
 * A recurring run is all-or-nothing, decided before anything is booked.
 *
 * planSeries is the pure half of the atomic series: it plans every occurrence
 * against one set of facts and stops at the first that cannot be booked, so the
 * route can create none rather than book the covered weeks and charge for a run
 * that was never whole. These pin exactly that — a single bad week fails the
 * lot, and the failing week is named.
 */
describe("planSeries — a recurring run is all or nothing (atomic)", () => {
  const series = (
    starts: Date[],
    overrides: Partial<Parameters<typeof planSeries>[0]> = {},
  ) =>
    planSeries({
      space: SPACE,
      host: HOST,
      // A run is a Pro feature, and Pro reaches far enough for these weeks.
      practitioner: { ...PRACTITIONER, isPro: true },
      takenStarts: [],
      declared: { purpose: "movement_session", attendees: 1 },
      now: NOW,
      starts,
      ...overrides,
    });

  const THREE_WEEKS = [at(14, 0), at(14, 7), at(14, 14)];

  it("plans every occurrence when they all pass", () => {
    const result = series(THREE_WEEKS);
    expect(result.ok).toBe(true);
    expect(result.ok && result.occurrences.map((o) => o.startsAt)).toEqual(THREE_WEEKS);
  });

  it("refuses the whole run, and names the week, when cover ends mid-series", () => {
    const shortWindow = {
      hasCertificate: true,
      state: "verified" as const,
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expiresAt: new Date("2026-08-05T00:00:00Z"), // covers Aug 3, not Aug 10 or 17
    };
    const result = series(THREE_WEEKS, {
      practitioner: { ...PRACTITIONER, isPro: true, insurance: shortWindow },
    });
    // First failing occurrence is Aug 10; nothing is planned past a refusal.
    expect(result).toEqual({
      ok: false,
      startsAt: at(14, 7),
      reason: "insurance_not_valid_for_date",
    });
  });

  it("refuses the whole run if any single week's hour is already taken", () => {
    const result = series(THREE_WEEKS, { takenStarts: [at(14, 7)] });
    expect(result).toEqual({ ok: false, startsAt: at(14, 7), reason: "slot_taken" });
  });

  it("refuses a run for an account with no professional profile", () => {
    const result = series([at(14, 0), at(14, 7)], {
      practitioner: { ...PRACTITIONER, isPro: true, accountType: null },
    });
    expect(result).toEqual({ ok: false, startsAt: at(14, 0), reason: "professional_profile_required" });
  });

  it("refuses the whole run when new bookings are paused", () => {
    // A pause is a fact about the person, not the week, so it fails at the first
    // occurrence and the run is never partially booked.
    const daysBeforeNow = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
    const lateCancel = (days: number) => {
      const at = daysBeforeNow(days);
      return {
        by: "practitioner" as const,
        at,
        sessionStart: new Date(at.getTime() + 2 * 3_600_000),
      };
    };
    const result = series([at(14, 0), at(14, 7)], {
      practitionerCancellations: [lateCancel(1), lateCancel(2), lateCancel(3)],
    });
    expect(result).toEqual({ ok: false, startsAt: at(14, 0), reason: "standing_paused" });
  });

  it("does not let two weeks of one run claim the same hour", () => {
    // The earlier week is added to what is taken, so the duplicate is caught.
    const result = series([at(14, 0), at(14, 0)]);
    expect(result).toEqual({ ok: false, startsAt: at(14, 0), reason: "slot_taken" });
  });
});
