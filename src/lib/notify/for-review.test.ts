import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reviewLifecycleActions, reviewNudgePhase } from "./for-review";

const end = new Date("2026-09-01T12:00:00.000Z");
const later = (hours: number) => new Date(end.getTime() + hours * 60 * 60 * 1000);

describe("reviewNudgePhase", () => {
  it("does not interrupt the session or the immediate trip home", () => {
    expect(reviewNudgePhase(end, later(1.99))).toBeNull();
  });

  it("asks once while the experience is fresh", () => {
    expect(reviewNudgePhase(end, later(2))).toBe("prompt");
    expect(reviewNudgePhase(end, later(71))).toBe("prompt");
  });

  it("uses one later reminder rather than a drip", () => {
    expect(reviewNudgePhase(end, later(72))).toBe("reminder");
    expect(reviewNudgePhase(end, later(24 * 9))).toBe("reminder");
  });

  it("stops nudging long before the 30-day window closes", () => {
    expect(reviewNudgePhase(end, later(24 * 10))).toBeNull();
    expect(reviewNudgePhase(end, later(24 * 31))).toBeNull();
  });
});

describe("blind-review lifecycle", () => {
  const first = {
    id: "review-1",
    booking_id: "booking-1",
    author_id: "practitioner-1",
    role: "practitioner" as const,
    created_at: "2026-09-01T12:00:00.000Z",
  };

  it("always confirms submission but keeps a lone review sealed before day 14", () => {
    expect(reviewLifecycleActions([first], later(24 * 13))).toEqual([
      {
        kind: "review_submitted",
        recipientId: "practitioner-1",
        subjectId: "review-1:author",
      },
    ]);
  });

  it("announces release when the 14-day blind period expires", () => {
    expect(reviewLifecycleActions([first], later(24 * 14))).toEqual([
      expect.objectContaining({ kind: "review_submitted" }),
      {
        kind: "review_published",
        recipientId: "practitioner-1",
        subjectId: "review-1",
      },
    ]);
  });

  it("confirms both submissions and tells the waiting first reviewer when both unlock", () => {
    const second = {
      id: "review-2",
      booking_id: "booking-1",
      author_id: "host-1",
      role: "host" as const,
      created_at: "2026-09-02T12:00:00.000Z",
    };

    expect(reviewLifecycleActions([second, first], later(24 * 2))).toEqual([
      expect.objectContaining({ kind: "review_submitted", recipientId: "practitioner-1" }),
      expect.objectContaining({ kind: "review_submitted", recipientId: "host-1" }),
      {
        kind: "counterpart_reviewed",
        recipientId: "practitioner-1",
        subjectId: "booking-1:practitioner",
      },
    ]);
  });
});
