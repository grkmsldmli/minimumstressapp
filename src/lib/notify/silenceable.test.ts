import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS } from "./messages";
import type { Recipient } from "./send";
import { hasOptedOut } from "./for-booking";

/**
 * Which messages a switch may stop, and which arrive regardless.
 *
 * The line is not a preference. A booking confirmation carries the door code
 * and the address; a cancellation is somebody's day changing; a refund
 * decision is money. None of those is a nudge, and a person who silenced them
 * would not learn they had until they were standing outside a locked studio.
 *
 * What may be silenced is the pair a host can see for themselves on a screen
 * they already have: that somebody booked, and that money moved.
 *
 * The practitioner profile offered two switches over this and neither worked —
 * one wrote the host's column from the wrong screen, the other wrote a column
 * nothing reads. This pins the rule underneath so the next switch has to face
 * it.
 */
/** Somebody who has turned off everything the profile screens offer. */
const recipient = (over: Partial<Recipient> = {}): Recipient => ({
  userId: "u1",
  name: "Sam",
  email: "sam@example.com",
  phone: null,
  wantsBookingAlerts: false,
  wantsPayoutAlerts: false,
  ...over,
});

/**
 * Everything a person is told about their own session, and about money.
 *
 * `host_new_booking` is the only kind SILENCEABLE actually reaches. Its other
 * entry, `host_payout_sent`, is not a notification anybody sends — which is
 * why it cannot be subtracted here, and why the host's "Payout alerts" switch
 * had nothing to switch.
 */
const NEVER_SILENCEABLE = NOTIFICATION_KINDS.filter((kind) => kind !== "host_new_booking");

describe("what a switch may stop", () => {
  it("lets a host mute the booking nudge", () => {
    expect(hasOptedOut(recipient(), "host_new_booking")).toBe(true);
  });

  it("sends the booking nudge when they have not muted it", () => {
    expect(hasOptedOut(recipient({ wantsBookingAlerts: true }), "host_new_booking")).toBe(false);
  });

  /**
   * The important half. Every one of these reaches somebody whether or not any
   * switch is off, and adding one to SILENCEABLE fails here.
   */
  it.each(NEVER_SILENCEABLE)("always sends %s", (kind) => {
    expect(hasOptedOut(recipient(), kind)).toBe(false);
  });

  it("treats an unknown kind as unstoppable rather than guessing", () => {
    expect(hasOptedOut(recipient(), "something_added_later")).toBe(false);
  });
});
