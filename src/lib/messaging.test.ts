import { describe, expect, it } from "vitest";

import {
  MESSAGING_CLOSED,
  MESSAGING_NOT_YET,
  bookingAcceptsMessages,
  messagingDisabledReason,
} from "./messaging";

describe("bookingAcceptsMessages — the client mirror of the server rule", () => {
  it("allows a confirmed practitioner booking (instant or approved)", () => {
    expect(bookingAcceptsMessages({ status: "upcoming", approvalState: "not_required" })).toBe(true);
    expect(bookingAcceptsMessages({ status: "upcoming", approvalState: "approved" })).toBe(true);
  });

  it("allows a completed session (no new closure window is invented)", () => {
    expect(bookingAcceptsMessages({ status: "completed", approvalState: "approved" })).toBe(true);
    expect(bookingAcceptsMessages({ status: "no_show", approvalState: "not_required" })).toBe(true);
  });

  it("refuses a pending request", () => {
    expect(bookingAcceptsMessages({ status: "upcoming", approvalState: "pending" })).toBe(false);
  });

  it("refuses a declined or expired request", () => {
    expect(bookingAcceptsMessages({ status: "upcoming", approvalState: "declined" })).toBe(false);
    expect(bookingAcceptsMessages({ status: "upcoming", approvalState: "expired" })).toBe(false);
  });

  it("refuses a cancelled booking, whatever the approval state", () => {
    expect(
      bookingAcceptsMessages({ status: "cancelled_by_practitioner", approvalState: "approved" }),
    ).toBe(false);
    expect(
      bookingAcceptsMessages({ status: "cancelled_by_host", approvalState: "not_required" }),
    ).toBe(false);
  });

  it("treats a host booking (no approvalState) as sendable unless cancelled", () => {
    // host_bookings() only ever returns captured sessions, so the only bar is
    // cancellation.
    expect(bookingAcceptsMessages({ status: "upcoming" })).toBe(true);
    expect(bookingAcceptsMessages({ status: "completed" })).toBe(true);
    expect(bookingAcceptsMessages({ status: "cancelled_by_host" })).toBe(false);
  });
});

describe("messagingDisabledReason — plain wording, no payment terms", () => {
  it("is null when messages can be sent", () => {
    expect(messagingDisabledReason({ status: "upcoming", approvalState: "approved" })).toBeNull();
  });

  it("explains a not-yet-confirmed booking", () => {
    expect(messagingDisabledReason({ status: "upcoming", approvalState: "pending" })).toBe(
      MESSAGING_NOT_YET,
    );
  });

  it("explains a closed (cancelled) booking", () => {
    expect(messagingDisabledReason({ status: "cancelled_by_host", approvalState: "approved" })).toBe(
      MESSAGING_CLOSED,
    );
  });

  it("never exposes payment terminology like 'captured'", () => {
    for (const reason of [MESSAGING_NOT_YET, MESSAGING_CLOSED]) {
      expect(reason).not.toMatch(/captured|payment|charge|paid/i);
    }
  });
});
