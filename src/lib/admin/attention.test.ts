import { describe, expect, it } from "vitest";

import { type QueueCounts, subjectFor, waitingOn, waitingSignature } from "./attention";

/**
 * What is worth interrupting somebody for, and what gets said first.
 *
 * The operator screen already shows all of this. What it cannot do is reach
 * anybody — a page has to be opened — so these rules decide when a person is
 * told, and being wrong in either direction has a cost. Too quiet and a host
 * stands in a studio waiting for money that is sitting with us. Too loud and
 * the mail gets filtered, which is the same as too quiet but harder to notice.
 */
const NOTHING: QueueCounts = {
  unpayableHosts: 0,
  openDisputes: 0,
  escalations: 0,
  pendingListings: 0,
  accountChangeRequests: 0,
  failedNotifications: 0,
};

describe("what is waiting", () => {
  it("says nothing when nothing is waiting", () => {
    expect(waitingOn(NOTHING)).toEqual([]);
    expect(subjectFor([])).toBe("");
  });

  it("leaves out the groups that are empty", () => {
    const items = waitingOn({ ...NOTHING, pendingListings: 2 });

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("pending_listing");
    expect(items[0].line).toBe("2 listings waiting for review");
  });

  it("counts one as one", () => {
    expect(waitingOn({ ...NOTHING, pendingListings: 1 })[0].line).toBe(
      "1 listing waiting for review",
    );
  });

  /**
   * A host who cannot be paid has already done their part: the room was
   * opened, the session happened, and the money is with us. Nothing else on
   * the list has somebody out of pocket while they wait.
   */
  it("puts the host who cannot be paid first", () => {
    const items = waitingOn({
      ...NOTHING,
      pendingListings: 9,
      failedNotifications: 4,
      unpayableHosts: 1,
    });

    expect(items[0].kind).toBe("unpayable_host");
  });

  it("puts a safety report above a money argument", () => {
    const items = waitingOn({ ...NOTHING, openDisputes: 3, escalations: 1 });

    expect(items.map((i) => i.kind)).toEqual(["escalation", "open_dispute"]);
  });
});

describe("the subject line", () => {
  it("leads with the worst thing and counts the rest", () => {
    const items = waitingOn({ ...NOTHING, unpayableHosts: 1, pendingListings: 2 });

    expect(subjectFor(items)).toBe("1 host cannot be paid, and 2 more waiting");
  });

  it("says only the one thing when there is one thing", () => {
    expect(subjectFor(waitingOn({ ...NOTHING, escalations: 1 }))).toBe("1 safety report to read");
  });
});

/**
 * The same news must not arrive twice, and new news must not wait.
 */
describe("not saying it twice", () => {
  const day = new Date("2026-08-14T09:00:00Z");

  it("gives an unchanged queue the same fingerprint", () => {
    const a = waitingOn({ ...NOTHING, pendingListings: 2 });
    const b = waitingOn({ ...NOTHING, pendingListings: 2 });

    expect(waitingSignature(a, day)).toBe(waitingSignature(b, day));
  });

  it("changes it the moment something new arrives", () => {
    const before = waitingOn({ ...NOTHING, pendingListings: 2 });
    const after = waitingOn({ ...NOTHING, pendingListings: 2, openDisputes: 1 });

    expect(waitingSignature(after, day)).not.toBe(waitingSignature(before, day));
  });

  it("changes it when one is dealt with and others remain", () => {
    const before = waitingOn({ ...NOTHING, pendingListings: 2 });
    const after = waitingOn({ ...NOTHING, pendingListings: 1 });

    expect(waitingSignature(after, day)).not.toBe(waitingSignature(before, day));
  });

  /**
   * A queue nobody has dealt with is raised again tomorrow rather than once
   * and never — the failure where the first email is missed and the system
   * stays quiet for a week.
   */
  it("raises the same queue again the next day", () => {
    const items = waitingOn({ ...NOTHING, pendingListings: 2 });
    const tomorrow = new Date("2026-08-15T09:00:00Z");

    expect(waitingSignature(items, tomorrow)).not.toBe(waitingSignature(items, day));
  });
});
