import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reviewNudgePhase } from "./for-review";

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
