import { describe, expect, it } from "vitest";

import {
  SESSION_MILESTONES,
  SESSION_MILESTONE_THRESHOLDS,
  hostAchievementProgress,
  highestSessionMilestone,
  sessionMilestoneLabel,
} from "./host-achievements";

describe("the ladder itself", () => {
  it("is the milestones the brief named, in order", () => {
    expect(SESSION_MILESTONES.map((m) => m.at)).toEqual([1, 10, 50, 100, 250, 500, 1000]);
    expect(SESSION_MILESTONES.map((m) => m.label)).toEqual([
      "First Booking",
      "10 Sessions",
      "50 Sessions",
      "100 Sessions",
      "250 Sessions",
      "500 Sessions",
      "1,000 Sessions",
    ]);
  });

  it("strictly ascends, so 'highest reached' is unambiguous", () => {
    for (let i = 1; i < SESSION_MILESTONE_THRESHOLDS.length; i++) {
      expect(SESSION_MILESTONE_THRESHOLDS[i]).toBeGreaterThan(SESSION_MILESTONE_THRESHOLDS[i - 1]);
    }
  });
});

describe("milestones trigger at the right number, not before", () => {
  it("earns First Booking on the first completed session and not at zero", () => {
    expect(highestSessionMilestone(0)).toBeNull();
    expect(highestSessionMilestone(1)?.label).toBe("First Booking");
  });

  it.each([
    [9, "First Booking"],
    [10, "10 Sessions"],
    [49, "10 Sessions"],
    [50, "50 Sessions"],
    [99, "50 Sessions"],
    [100, "100 Sessions"],
    [249, "100 Sessions"],
    [250, "250 Sessions"],
    [500, "500 Sessions"],
    [999, "500 Sessions"],
    [1000, "1,000 Sessions"],
    [4000, "1,000 Sessions"],
  ])("at %i sessions the highest earned is %s", (sessions, label) => {
    expect(highestSessionMilestone(sessions)?.label).toBe(label);
  });
});

describe("progress toward the next milestone", () => {
  it("reads the brief's own example: 87 completed, 13 to 100", () => {
    const p = hostAchievementProgress(87);
    expect(p.completed).toBe(87);
    expect(p.earned?.label).toBe("50 Sessions");
    expect(p.next?.label).toBe("100 Sessions");
    expect(p.toNext).toBe(13);
  });

  it("at zero it is calm progress toward First Booking, nothing earned", () => {
    const p = hostAchievementProgress(0);
    expect(p.earned).toBeNull();
    expect(p.next?.label).toBe("First Booking");
    expect(p.toNext).toBe(1);
  });

  it("once every milestone is earned there is no next and no distance", () => {
    const p = hostAchievementProgress(1200);
    expect(p.earned?.label).toBe("1,000 Sessions");
    expect(p.next).toBeNull();
    expect(p.toNext).toBeNull();
  });
});

describe("sessionMilestoneLabel maps the public bucket to words", () => {
  it("turns a bucket into the milestone name", () => {
    expect(sessionMilestoneLabel(100)).toBe("100 Sessions");
    expect(sessionMilestoneLabel(1)).toBe("First Booking");
    expect(sessionMilestoneLabel(1000)).toBe("1,000 Sessions");
  });

  it("shows nothing for the empty bucket or an unknown value", () => {
    // 0 is the view's 'no milestone reached' — it must read as no badge at all,
    // never as a milestone. A between-threshold number is not a bucket.
    expect(sessionMilestoneLabel(0)).toBeNull();
    expect(sessionMilestoneLabel(87)).toBeNull();
  });
});
