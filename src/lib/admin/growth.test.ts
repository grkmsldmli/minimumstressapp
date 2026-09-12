import { describe, expect, it } from "vitest";

import { growthView, type RawEvent } from "./growth";
import type { FunnelStep } from "./queue";

const funnel: FunnelStep[] = [
  { label: "Signed up", count: 20 },
  { label: "Chose a side", count: 15 },
];

describe("growthView", () => {
  it("reports the funnel and an uninstrumented event stream honestly", () => {
    const v = growthView(funnel, []);
    expect(v.funnel).toEqual(funnel);
    expect(v.instrumented).toBe(false);
    expect(v.events.total).toBe(0);
    expect(v.notInstrumented.length).toBeGreaterThan(0);
  });

  it("counts events, distinct sessions and users when instrumented", () => {
    const events: RawEvent[] = [
      { event_name: "booking_confirmed", occurred_at: "2026-09-01", session_id: "s1", anonymous_id: null, user_id: "u1" },
      { event_name: "booking_confirmed", occurred_at: "2026-09-02", session_id: "s1", anonymous_id: null, user_id: "u1" },
      { event_name: "payment_succeeded", occurred_at: "2026-09-02", session_id: "s2", anonymous_id: null, user_id: "u2" },
    ];
    const v = growthView(funnel, events);
    expect(v.instrumented).toBe(true);
    expect(v.events.total).toBe(3);
    expect(v.events.distinctSessions).toBe(2);
    expect(v.events.distinctUsers).toBe(2);
    // Sorted by count, descending.
    expect(v.events.byName[0]).toEqual({ name: "booking_confirmed", count: 2 });
  });
});
