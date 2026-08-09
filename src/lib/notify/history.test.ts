import { describe, expect, it } from "vitest";

import { describeNotification, explainState } from "./history";
import type { NotificationKind } from "./messages";

/**
 * Every kind the app sends has a line here, because a history that silently
 * drops a message is the app hiding that it wrote to somebody.
 */
const EVERY_KIND: NotificationKind[] = [
  "booking_confirmed",
  "host_new_booking",
  "access_code_ready",
  "cancelled_by_practitioner",
  "cancelled_by_host",
  "reliability_warning",
  "reliability_suspended",
  "payout_failed",
  "safety_escalation",
  "account_change_requested",
];

describe("describeNotification", () => {
  it.each(EVERY_KIND)("has wording for %s", (kind) => {
    const label = describeNotification(kind);

    expect(label).not.toBe("A message from Minimum Stress");
    expect(label.length).toBeGreaterThan(10);
  });

  /** A kind nobody wrote a line for still appears, rather than vanishing. */
  it("falls back rather than dropping an unknown kind", () => {
    expect(describeNotification("something_new")).toBe("A message from Minimum Stress");
  });

  it("never shows the raw kind to a person", () => {
    for (const kind of EVERY_KIND) {
      expect(describeNotification(kind)).not.toContain("_");
    }
  });
});

describe("explainState", () => {
  /**
   * The one this feature exists for. Somebody stood outside a door needs to
   * know the code was never delivered, not that it is "pending".
   */
  it("says plainly when something did not arrive", () => {
    expect(explainState("failed")).toBe("Could not be delivered");
  });

  it("distinguishes sent from still sending", () => {
    expect(explainState("sent")).not.toBe(explainState("queued"));
  });
});
