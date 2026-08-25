import type { Booking } from "./domain";

/**
 * Which booking the payment and confirmation screens should render.
 *
 * `listed` is what listMyBookings returns, which hides an in-flight checkout
 * hold on purpose (see isHeldBooking). So the booking a person is about to pay
 * for is not in that list yet: the freshly created hold has to be carried
 * separately and offered here as a fallback. Once the webhook captures the
 * booking it reappears in `listed`, which is authoritative and wins.
 *
 * The hold is only used when it is the one being acted on — its id matches the
 * active booking — so a stale hold from an abandoned checkout can never stand in
 * for a different booking.
 */
export function resolveActiveBooking(
  listed: Booking[],
  checkoutHold: Booking | null,
  activeBookingId: string | null,
): Booking | null {
  if (activeBookingId === null) return null;
  const fromList = listed.find((b) => b.id === activeBookingId);
  if (fromList) return fromList;
  return checkoutHold?.id === activeBookingId ? checkoutHold : null;
}
