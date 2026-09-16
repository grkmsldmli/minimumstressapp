import { describe, expect, it } from "vitest";

import { notificationDestination } from "./destination";

describe("resolved notification destination", () => {
  const practitioner = new Set(["practitioner-booking"]);
  const host = new Set(["host-booking"]);

  it("opens the exact participant thread for a new message", () => {
    expect(
      notificationDestination(
        { bookingId: "host-booking", kind: "new_message" },
        practitioner,
        host,
      ),
    ).toEqual({ screen: "thread", bookingId: "host-booking" });
  });

  it("opens review prompts on the correct side", () => {
    expect(
      notificationDestination(
        { bookingId: "practitioner-booking", kind: "review_prompt" },
        practitioner,
        host,
      ),
    ).toEqual({
      screen: "review",
      bookingId: "practitioner-booking",
      role: "practitioner",
    });
    expect(
      notificationDestination(
        { bookingId: "host-booking", kind: "review_reminder" },
        practitioner,
        host,
      ),
    ).toEqual({ screen: "review", bookingId: "host-booking", role: "host" });
  });

  it("falls back without disclosing an absent booking or unsupported event", () => {
    expect(
      notificationDestination(
        { bookingId: "another-account", kind: "new_message" },
        practitioner,
        host,
      ),
    ).toEqual({ screen: "notifications" });
    expect(
      notificationDestination(
        { bookingId: "host-booking", kind: "booking_confirmed" },
        practitioner,
        host,
      ),
    ).toEqual({ screen: "notifications" });
    expect(notificationDestination(null, practitioner, host)).toEqual({
      screen: "notifications",
    });
  });
});
