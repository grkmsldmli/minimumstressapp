import { beforeEach, describe, expect, it } from "vitest";

import { MockRepository } from "./mock-repository";
import { emptySessionDetails } from "./work/session-details";

/**
 * The mock's Work surface, proving the plain business shape without a database:
 * the opt-in persists, availability round-trips, templates CRUD, and a coverage
 * request goes open -> filled exactly once. Timezone/matching correctness is
 * proved in the pure and pglite tests, not here.
 */
describe("MockRepository — Work", () => {
  let repo: MockRepository;
  beforeEach(() => {
    repo = new MockRepository();
  });

  it("the Available for Work switch and preferences persist across reads", async () => {
    expect((await repo.getWorkPreferences()).availableForWork).toBe(false);
    await repo.updateWorkPreferences({ availableForWork: true, maxTravelMiles: 20, minPayCents: 5000 });
    const prefs = await repo.getWorkPreferences();
    expect(prefs.availableForWork).toBe(true);
    expect(prefs.maxTravelMiles).toBe(20);
    expect(prefs.minPayCents).toBe(5000);
  });

  it("weekly availability round-trips and normalises", async () => {
    await repo.setWorkAvailability([
      { weekday: 1, startMinute: 540, endMinute: 780 },
      { weekday: 1, startMinute: 780, endMinute: 900 }, // touches the previous → merged
    ]);
    const blocks = await repo.getWorkAvailability();
    expect(blocks).toEqual([{ weekday: 1, startMinute: 540, endMinute: 900 }]);
  });

  it("class templates create, list, and archive", async () => {
    const created = await repo.createClassTemplate({
      title: "Reformer Flow 1",
      profession: "pilates",
      level: "Intermediate",
      equipment: "Reformer",
      durationMinutes: 50,
      maxParticipants: 8,
      notes: null,
      arrivalNotes: null,
      requiresCredential: false,
      defaultPayCents: null,
      ...emptySessionDetails(),
    });
    expect((await repo.listClassTemplates()).map((t) => t.id)).toContain(created.id);
    await repo.archiveClassTemplate(created.id);
    expect((await repo.listClassTemplates()).map((t) => t.id)).not.toContain(created.id);
  });

  it("a coverage request goes open, then filled exactly once", async () => {
    const request = await repo.createCoverageRequest({
      spaceId: null,
      title: "Cover my 6pm",
      profession: "yoga",
      level: null,
      participantsMax: null,
      equipmentNotes: null,
      startsAt: new Date(Date.now() + 2 * 86_400_000),
      durationMinutes: 60,
      payCents: 6000,
      notes: null,
      urgent: false,
      ...emptySessionDetails(),
    });
    expect(request.state).toBe("open");

    await repo.confirmRequestInterest(request.id, "someone");
    expect((await repo.listCoverageRequests())[0].state).toBe("filled");

    // A second confirm cannot re-fill it.
    await expect(repo.confirmRequestInterest(request.id, "another")).rejects.toThrow();
  });

  it("duplicating a request copies its session context into a fresh open one", async () => {
    const original = await repo.createCoverageRequest({
      spaceId: null,
      title: "Reformer Flow",
      profession: "pilates",
      level: "Intermediate",
      participantsMax: 8,
      equipmentNotes: "Reformers provided",
      startsAt: new Date(Date.now() + 2 * 86_400_000),
      durationMinutes: 50,
      payCents: 6000,
      notes: "Bring the playlist",
      urgent: true,
      ...emptySessionDetails(),
      sessionFormat: "group",
      requiredQualifications: ["Reformer cert"],
    });

    const newStart = new Date(Date.now() + 9 * 86_400_000);
    const copy = await repo.duplicateCoverageRequest(original.id, newStart);

    expect(copy.id).not.toBe(original.id);
    expect(copy.state).toBe("open");
    expect(copy.startsAt.getTime()).toBe(newStart.getTime());
    // The session context is carried over verbatim…
    expect(copy.title).toBe("Reformer Flow");
    expect(copy.sessionFormat).toBe("group");
    expect(copy.level).toBe("Intermediate");
    expect(copy.participantsMax).toBe(8);
    expect(copy.equipmentNotes).toBe("Reformers provided");
    expect(copy.requiredQualifications).toEqual(["Reformer cert"]);
    // …but the duration (and so the derived end) matches the original.
    expect(copy.endsAt.getTime() - copy.startsAt.getTime()).toBe(50 * 60 * 1000);
    // A repost carries no applicants — it is a brand-new request.
    expect(copy.interestCount).toBe(0);
  });

  it("the roster adds, lists, and removes", async () => {
    expect(await repo.listRoster()).toEqual([]);
    await repo.addToRoster("prac-1", "Great with beginners");
    const roster = await repo.listRoster();
    expect(roster).toHaveLength(1);
    expect(roster[0].note).toBe("Great with beginners");
    // Adding the same practitioner again does not duplicate them.
    await repo.addToRoster("prac-1", "again");
    expect(await repo.listRoster()).toHaveLength(1);
    await repo.removeFromRoster(roster[0].id);
    expect(await repo.listRoster()).toEqual([]);
  });

  it("a request can be cancelled while open, but not once filled", async () => {
    const r = await repo.createCoverageRequest({
      spaceId: null,
      title: "Cover",
      profession: null,
      level: null,
      participantsMax: null,
      equipmentNotes: null,
      startsAt: new Date(Date.now() + 2 * 86_400_000),
      durationMinutes: 60,
      payCents: 5000,
      notes: null,
      urgent: false,
      ...emptySessionDetails(),
    });
    await repo.cancelCoverageRequest(r.id);
    expect((await repo.listCoverageRequests())[0].state).toBe("cancelled");
    await expect(repo.cancelCoverageRequest(r.id)).rejects.toThrow();
  });
});
