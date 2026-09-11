import { describe, expect, it } from "vitest";

import type { CoverageRequest } from "../domain";
import { repostPrefill } from "./repost";

/**
 * What a repost carries — and, just as important, what it does not. The reusable
 * class shape comes across so a studio doesn't retype a weekly class; the date
 * and the private-session context never do, because a repost is a new session
 * and stale private notes must not be silently reused.
 */
function request(over: Partial<CoverageRequest> = {}): CoverageRequest {
  return {
    id: "req_1",
    classTemplateId: null,
    spaceId: "space_1",
    spaceName: "Studio A",
    title: "Reformer Flow",
    profession: "pilates",
    level: "Intermediate",
    participantsMax: 8,
    equipmentNotes: "Reformers provided",
    startsAt: new Date("2026-01-10T18:00:00Z"),
    endsAt: new Date("2026-01-10T18:50:00Z"),
    timeZone: "America/Los_Angeles",
    payCents: 6000,
    notes: "old note",
    urgent: true,
    state: "completed",
    interestCount: 3,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    sessionFormat: "group",
    participantsExpected: 6,
    audience: "Drop-in regulars",
    teachingNotes: "Keep it flowing",
    requiredQualifications: ["Reformer cert"],
    preferredQualifications: ["Prenatal experience"],
    sessionGoal: null,
    clientExperience: null,
    accommodations: null,
    programming: null,
    ...over,
  };
}

describe("repostPrefill", () => {
  it("carries the reusable class shape", () => {
    const p = repostPrefill(request());
    expect(p.spaceId).toBe("space_1");
    expect(p.title).toBe("Reformer Flow");
    expect(p.profession).toBe("pilates");
    expect(p.sessionFormat).toBe("group");
    expect(p.level).toBe("Intermediate");
    expect(p.participantsExpected).toBe("6");
    expect(p.participantsMax).toBe("8");
    expect(p.audience).toBe("Drop-in regulars");
    expect(p.teachingNotes).toBe("Keep it flowing");
    expect(p.equipmentNotes).toBe("Reformers provided");
    expect(p.requiredQuals).toBe("Reformer cert");
    expect(p.preferredQuals).toBe("Prenatal experience");
    expect(p.urgent).toBe(true);
  });

  it("derives pay in dollars and duration in minutes from the source", () => {
    const p = repostPrefill(request());
    expect(p.pay).toBe("60"); // 6000 cents
    expect(p.duration).toBe("50"); // 18:00 -> 18:50
  });

  it("never carries a date or time — a repost must be given a new future one", () => {
    const p = repostPrefill(request()) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty("startsAt");
    expect(p).not.toHaveProperty("date");
    expect(p).not.toHaveProperty("dateStr");
    expect(p).not.toHaveProperty("timeStr");
  });

  it("never carries private-session context, even when the source had it", () => {
    const p = repostPrefill(
      request({
        sessionFormat: "private",
        sessionGoal: "Rehab left knee",
        clientExperience: "Post-op, 6 weeks",
        accommodations: "No deep flexion",
        programming: "continue",
      }),
    ) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty("sessionGoal");
    expect(p).not.toHaveProperty("clientExperience");
    expect(p).not.toHaveProperty("accommodations");
    expect(p).not.toHaveProperty("programming");
    // And none of the sensitive strings leaked into any field.
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain("Rehab");
    expect(serialized).not.toContain("Post-op");
    expect(serialized).not.toContain("deep flexion");
  });

  it("does not mutate the source request", () => {
    const src = request();
    const before = JSON.stringify(src);
    repostPrefill(src);
    expect(JSON.stringify(src)).toBe(before);
  });
});
