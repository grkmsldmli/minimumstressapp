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
import {
  bookingMoneyFromQuote,
  isInstantSlot,
  isWithinBookingHorizon,
  quote,
  type BookingMoney,
} from "./money";
import { earnedBookingHorizonDays, earnsInstantFeeWaiver } from "./standing-points";

export interface SpaceFacts {
  id: string;
  hostId: string;
  hourlyRateCents: number;
  bufferMinutes: number;
  status: "pending" | "active" | "delisted";
  availability: AvailabilityBlock[];
}

export interface HostFacts {
  stripeAccountId: string | null;
  chargesEnabled: boolean;
}

export interface PractitionerFacts {
  id: string;
  isPro: boolean;
  creditBalanceCents: number;
  /**
   * Earned standing. Read server-side from the points view, never sent by the
   * caller — a client that could claim its own total could claim a horizon and
   * a fee waiver with it.
   */
  points: number;
}

export type PlanRejection =
  | "space_not_found"
  | "space_not_active"
  | "host_cannot_be_paid"
  | "slot_in_past"
  | "beyond_booking_horizon"
  | "slot_not_open"
  | "slot_taken";

export type BookingPlan =
  | { ok: false; reason: PlanRejection }
  | { ok: true; money: BookingMoney; isInstant: boolean };

export function planBooking(input: {
  space: SpaceFacts | null;
  host: HostFacts | null;
  practitioner: PractitionerFacts;
  /** Start times already booked on this space. */
  takenStarts: readonly Date[];
  startsAt: Date;
  now: Date;
}): BookingPlan {
  const { space, host, practitioner, takenStarts, startsAt, now } = input;

  if (!space) return { ok: false, reason: "space_not_found" };
  if (space.status !== "active") return { ok: false, reason: "space_not_active" };

  // Refusing here rather than at payout time. Taking money for a host who
  // cannot receive it leaves the platform holding funds with nowhere to send
  // them, and a practitioner with a booking nobody can honour.
  if (!host?.stripeAccountId || !host.chargesEnabled) {
    return { ok: false, reason: "host_cannot_be_paid" };
  }

  if (startsAt.getTime() <= now.getTime()) return { ok: false, reason: "slot_in_past" };

  // The horizon is a paid Pro benefit, so it is checked against the stored
  // flag rather than anything the caller asserted.
  if (
    !isWithinBookingHorizon(
      startsAt,
      now,
      practitioner.isPro,
      earnedBookingHorizonDays(practitioner.points),
    )
  ) {
    return { ok: false, reason: "beyond_booking_horizon" };
  }

  // The slot grid is a convenience, not a control. Without this check a
  // crafted request books 3am on a day the host never opened.
  const offered = slotStartsForDate(space.availability, startsAt, space.bufferMinutes);
  if (!offered.some((slot) => slot.getTime() === startsAt.getTime())) {
    return { ok: false, reason: "slot_not_open" };
  }

  if (takenStarts.some((taken) => taken.getTime() === startsAt.getTime())) {
    return { ok: false, reason: "slot_taken" };
  }

  const isInstant = isInstantSlot(startsAt, now);

  return {
    ok: true,
    isInstant,
    money: bookingMoneyFromQuote(
      quote({
        hostRateCents: space.hourlyRateCents,
        isInstant,
        isPro: practitioner.isPro,
        creditBalanceCents: practitioner.creditBalanceCents,
        instantFeeWaived: earnsInstantFeeWaiver(practitioner.points),
      }),
    ),
  };
}

/** Human wording for each refusal, kept next to the reasons they explain. */
export function explainRejection(reason: PlanRejection): { message: string; status: number } {
  switch (reason) {
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
  }
}
