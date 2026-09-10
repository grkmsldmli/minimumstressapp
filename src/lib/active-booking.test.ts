import { describe, expect, it } from "vitest";

import type { Booking } from "./domain";
import { resolveActiveBooking } from "./active-booking";

/**
 * The payment/confirmation screens must be able to render a booking the list
 * hides. The bug this guards: a freshly created instant hold is not in
 * listMyBookings (it hides unpaid holds), so resolving only against the list
 * returned nothing and the screen fell to the not-found fallback.
 */
const booking = (id: string): Booking => ({ id }) as Booking;

describe("resolveActiveBooking", () => {
  it("returns the listed booking when it is present", () => {
    const listed = [booking("b1"), booking("b2")];
    expect(resolveActiveBooking(listed, null, "b2")?.id).toBe("b2");
  });

  it("falls back to the checkout hold the list hides", () => {
    // The just-created instant hold: not in the list, but the one being paid for.
    const hold = booking("hold-1");
    expect(resolveActiveBooking([], hold, "hold-1")?.id).toBe("hold-1");
  });

  it("prefers the listed (captured) row over the hold once it reappears", () => {
    const listed = [booking("hold-1")]; // captured by the webhook, now visible
    const hold = booking("hold-1");
    // Same id; the list is authoritative, so identity is the listed instance.
    expect(resolveActiveBooking(listed, hold, "hold-1")).toBe(listed[0]);
  });

  it("never uses a stale hold for a different booking", () => {
    const hold = booking("old-hold");
    expect(resolveActiveBooking([], hold, "something-else")).toBeNull();
  });

  it("is null when nothing is active", () => {
    expect(resolveActiveBooking([booking("b1")], booking("h1"), null)).toBeNull();
  });

  it("is null when neither the list nor the hold has the active id", () => {
    expect(resolveActiveBooking([booking("b1")], null, "missing")).toBeNull();
  });
});
