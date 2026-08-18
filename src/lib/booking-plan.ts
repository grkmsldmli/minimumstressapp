/**
 * The decision half of making a booking, with no database and no Stripe.
 *
 * Everything that determines what someone is charged lives here, computed from
 * rows the client cannot write. The request contributes a space id and a start
 * time; it contributes no price, no instant flag, no Pro status and no credit
 * amount. A client able to name its own total would name a smaller one.
 *
 * Separated from `booking-service.ts` so these rules can be tested exhaustively
 * without mocking a query builder — the plumbing around them is thin, the rules
 * are where the money is.
 */

import { slotStartsForDate, type AvailabilityBlock } from "./availability";
import { civilIn } from "./timezone";
import { tooCloseToRequest } from "./booking-approval";
import {
  MAX_UPCOMING_BOOKINGS_FREE,
  bookingMoneyFromQuote,
  isInstantSlot,
  isWithinBookingHorizon,
  quote,
  type BookingMoney,
} from "./money";
import {
  type DeclaredUse,
  type SpaceRules,
  type UseRejection,
  checkDeclaredUse,
  explainUseRejection,
} from "./booking-use";

export interface SpaceFacts {
  id: string;
  hostId: string;
  hourlyRateCents: number;
  bufferMinutes: number;
  /** How many people fit. Checked against what the booking declares. */
  capacity: number;
  /** What the host offers the room for. Empty means everything permitted. */
  allowedUses: readonly string[];
  /** Whether the host answers first, or the booking simply goes through. */
  bookingMode: "request" | "instant";
  status: "pending" | "active" | "delisted";
  /** The room's own zone. Availability minutes are wall-clock times in it. */
  timeZone: string;
  availability: AvailabilityBlock[];
}

export interface HostFacts {
  stripeAccountId: string | null;
  /**
   * Whether money can both be taken and reach their bank.
   *
   * Not "charges enabled", despite the column it comes from being called that.
   * The webhook writes `charges_enabled && payouts_enabled` into it, so the
   * stored value already means payable — and reading the name at face value
   * suggests this check is weaker than it is.
   */
  payable: boolean;
}

export interface PractitionerFacts {
  id: string;
  isPro: boolean;
}

export type PlanRejection =
  | UseRejection
  | "space_not_found"
  | "space_not_active"
  | "host_cannot_be_paid"
  | "slot_in_past"
  | "beyond_booking_horizon"
  | "slot_not_open"
  | "slot_taken"
  | "too_many_upcoming"
  | "too_soon_to_request";

export type BookingPlan =
  | { ok: false; reason: PlanRejection }
  | {
      ok: true;
      money: BookingMoney;
      isInstant: boolean;
      /**
       * Whether this booking is confirmed on payment or waits for the host.
       *
       * It also decides what happens to the money: a request holds the card
       * and captures on approval, an ordinary booking takes it outright. See
       * booking-approval.ts for why a hold is safe on one and not the other.
       */
      needsApproval: boolean;
    };

export function planBooking(input: {
  space: SpaceFacts | null;
  host: HostFacts | null;
  practitioner: PractitionerFacts;
  /** Start times already booked on this space. */
  takenStarts: readonly Date[];
  /** This practitioner's own sessions still ahead, across every space. */
  upcomingCount?: number;
  /**
   * What the person booking says they will do, and how many will be there.
   *
   * Checked here rather than at the form, because the form is not the only
   * caller and a rule that lives in a component is a rule an API route does
   * not have. Optional in the type only so the existing tests that predate it
   * still describe what they were written to describe; the service always
   * passes one, and a missing declaration is a rejection rather than a pass.
   */
  declared?: DeclaredUse | null;
  startsAt: Date;
  now: Date;
}): BookingPlan {
  const {
    space,
    host,
    practitioner,
    takenStarts,
    startsAt,
    now,
    upcomingCount = 0,
    declared = null,
  } = input;

  if (!space) return { ok: false, reason: "space_not_found" };
  if (space.status !== "active") return { ok: false, reason: "space_not_active" };

  // Refusing here rather than at payout time. Taking money for a host who
  // cannot receive it leaves the platform holding funds with nowhere to send
  // them, and a practitioner with a booking nobody can honour.
  if (!host?.stripeAccountId || !host.payable) {
    return { ok: false, reason: "host_cannot_be_paid" };
  }

  if (startsAt.getTime() <= now.getTime()) return { ok: false, reason: "slot_in_past" };

  /*
   * Checked before the slot is examined, so the answer does not depend on
   * which room was tapped. Somebody at their limit is at their limit
   * everywhere, and finding that out only after picking a time would be the
   * app letting them get further in than it means to.
   */
  if (!practitioner.isPro && upcomingCount >= MAX_UPCOMING_BOOKINGS_FREE) {
    return { ok: false, reason: "too_many_upcoming" };
  }

  // The horizon is a paid Pro benefit, so it is checked against the stored
  // flag rather than anything the caller asserted.
  if (!isWithinBookingHorizon(startsAt, now, practitioner.isPro, space.timeZone)) {
    return { ok: false, reason: "beyond_booking_horizon" };
  }

  // The slot grid is a convenience, not a control. Without this check a
  // crafted request books 3am on a day the host never opened.
  /*
   * Which of the room's days this instant falls on, asked of the room's own
   * calendar. Reading the fields off `startsAt` directly is what broke this:
   * the server's calendar is UTC, so a Tuesday evening in California arrived
   * as Wednesday and was checked against the wrong day's hours.
   */
  const day = civilIn(startsAt, space.timeZone);
  const offered = slotStartsForDate(
    space.availability,
    day,
    space.timeZone,
    space.bufferMinutes,
  );
  if (!offered.some((slot) => slot.getTime() === startsAt.getTime())) {
    return { ok: false, reason: "slot_not_open" };
  }

  if (takenStarts.some((taken) => taken.getTime() === startsAt.getTime())) {
    return { ok: false, reason: "slot_taken" };
  }

  /*
   * What the room is for, checked last.
   *
   * After the hour is known to be free, so somebody who picked a taken slot is
   * told that rather than being asked to justify a booking they cannot have.
   */
  const useProblem = checkDeclaredUse(declared, {
    allowedUses: space.allowedUses,
    capacity: space.capacity,
  });
  if (useProblem) return { ok: false, reason: useProblem };

  const isInstant = isInstantSlot(startsAt, now);
  const needsApproval = space.bookingMode === "request";

  /*
   * A request nobody could answer in time is not worth taking.
   *
   * Last, because it is the narrowest reason to refuse and somebody who also
   * picked a taken hour should hear about the hour. A request made forty
   * minutes before the session can only expire — the host has no window to
   * answer in — so it would hold the money, block the hour and end in nothing.
   * Refusing here is the honest version of that.
   */
  if (needsApproval && tooCloseToRequest(startsAt, now)) {
    return { ok: false, reason: "too_soon_to_request" };
  }

  return {
    ok: true,
    isInstant,
    needsApproval,
    money: bookingMoneyFromQuote(
      quote({
        hostRateCents: space.hourlyRateCents,
        isInstant,
        isPro: practitioner.isPro,
      }),
    ),
  };
}

/**
 * Human wording for each refusal, kept next to the reasons they explain.
 *
 * The use rejections take the room's own numbers, so "this room takes 6" says
 * six rather than sending somebody to count the listing again.
 */
export function explainRejection(
  reason: PlanRejection,
  rules: SpaceRules = { allowedUses: [], capacity: 0 },
): { message: string; status: number } {
  switch (reason) {
    case "purpose_missing":
    case "purpose_unknown":
    case "purpose_needs_detail":
    case "use_not_allowed":
    case "attendees_missing":
    case "too_many_attendees":
      return { message: explainUseRejection(reason, rules), status: 409 };
    case "space_not_found":
      return { message: "No such space", status: 404 };
    case "space_not_active":
      return { message: "That space is not accepting bookings", status: 409 };
    case "host_cannot_be_paid":
      return { message: "This host has not finished setting up payouts", status: 409 };
    case "slot_in_past":
      return { message: "That time has already passed", status: 409 };
    case "beyond_booking_horizon":
      return { message: "That is beyond your booking window", status: 409 };
    case "slot_not_open":
      return { message: "That hour is not open", status: 409 };
    case "slot_taken":
      return { message: "Someone just took that hour", status: 409 };
    case "too_many_upcoming":
      return {
        message: `You have ${MAX_UPCOMING_BOOKINGS_FREE} sessions booked. Finish one, or go Pro to book as many at a time as you like.`,
        status: 409,
      };

    case "too_soon_to_request":
      return {
        message: `This host accepts bookings themselves, and that is too soon for them to answer. Pick a later time, or a room that books straight away.`,
        status: 409,
      };
  }
}
