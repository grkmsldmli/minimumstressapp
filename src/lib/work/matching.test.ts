import { describe, expect, it } from "vitest";

import type { InsuranceFacts } from "../insurance";
import { civilIn, instantFrom, weekdayOf } from "../timezone";
import {
  type CandidateFacts,
  type RequestFacts,
  coversWindow,
  matchCandidate,
  rankCandidates,
} from "./matching";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

// A concrete window built the only safe way — a wall time in a named zone
// resolved to an absolute instant — so the assertions hold under any runner TZ
// (the prior UTC/local bug). 2026-06-15 16:00–17:00 Los Angeles.
const START = instantFrom({ year: 2026, month: 6, day: 15 }, 16 * 60, LA)!;
const END = instantFrom({ year: 2026, month: 6, day: 15 }, 17 * 60, LA)!;
// Well before the session, so insurance and standing are read at a real "now".
const NOW = new Date(START.getTime() - 2 * 86_400_000);

/** A block on whatever weekday the window falls on in `zone`, so the weekday is never guessed. */
function block(zone: string, startMin: number, endMin: number) {
  return { weekday: weekdayOf(civilIn(START, zone)), startMinute: startMin, endMinute: endMin };
}

const verified: InsuranceFacts = {
  hasCertificate: true,
  state: "verified",
  effectiveDate: new Date(START.getTime() - 30 * 86_400_000),
  expiresAt: new Date(START.getTime() + 365 * 86_400_000),
};

const REQUEST: RequestFacts = {
  hostId: "host-1",
  profession: "pilates",
  startsAt: START,
  endsAt: END,
  payCents: 6000,
  space: { lat: 37.5, lng: -122.3 },
};

function candidate(overrides: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    practitionerId: "prac-1",
    availableForWork: true,
    profession: "pilates",
    workZone: LA,
    availability: [block(LA, 15 * 60, 18 * 60)], // 3–6pm LA covers 4–5pm
    base: { lat: 37.5, lng: -122.305 }, // ~0.3 mi from the room
    maxTravelMiles: null,
    minPayCents: null,
    completedSessions: 5,
    goodStanding: true,
    eligibility: {
      accountType: "practitioner",
      profession: "pilates",
      identityVerified: true,
      credentialVerified: true,
      insurance: verified,
      cancellations: [],
    },
    ...overrides,
  };
}

describe("coversWindow (timezone-safe overlap)", () => {
  it("covers a window inside a block in the practitioner's own zone", () => {
    expect(coversWindow([block(LA, 15 * 60, 18 * 60)], LA, START, END)).toBe(true);
  });

  it("rejects a window outside every block on that day", () => {
    expect(coversWindow([block(LA, 6 * 60, 10 * 60)], LA, START, END)).toBe(false);
  });

  it("reads the window on the practitioner's clock, not the studio's", () => {
    // 16:00 LA is 19:00 NY. A New York practitioner free 19:00–20:00 covers it…
    expect(coversWindow([block(NY, 19 * 60, 20 * 60)], NY, START, END)).toBe(true);
    // …but a 19:00 block in LA (22:00 NY) does not.
    expect(coversWindow([block(LA, 19 * 60, 20 * 60)], LA, START, END)).toBe(false);
  });
});

describe("matchCandidate", () => {
  it("matches a ready, nearby, available practitioner", () => {
    const r = matchCandidate(REQUEST, candidate(), NOW);
    expect(r.matches).toBe(true);
    expect(r.misses).toEqual([]);
  });

  it("excludes a practitioner who is not available for work", () => {
    expect(matchCandidate(REQUEST, candidate({ availableForWork: false }), NOW).misses).toContain(
      "not_available",
    );
  });

  it("never matches a request to its own poster (no self-match)", () => {
    expect(matchCandidate(REQUEST, candidate({ practitionerId: "host-1" }), NOW).misses).toContain(
      "self",
    );
  });

  it("excludes an ineligible practitioner", () => {
    const c = candidate({
      eligibility: { ...candidate().eligibility, identityVerified: false },
    });
    expect(matchCandidate(REQUEST, c, NOW).misses).toContain("ineligible");
  });

  it("excludes a practitioner whose insurance lapses before this class", () => {
    const c = candidate({
      eligibility: {
        ...candidate().eligibility,
        insurance: { ...verified, expiresAt: new Date(START.getTime() - 86_400_000) },
      },
    });
    expect(matchCandidate(REQUEST, c, NOW).misses).toContain("insurance_window");
  });

  it("excludes an incompatible modality", () => {
    expect(matchCandidate(REQUEST, candidate({ profession: "massage" }), NOW).misses).toContain(
      "modality",
    );
  });

  it("excludes a practitioner not free in that window", () => {
    expect(
      matchCandidate(REQUEST, candidate({ availability: [block(LA, 6 * 60, 10 * 60)] }), NOW).misses,
    ).toContain("availability");
  });

  it("excludes a practitioner beyond their own travel radius", () => {
    const c = candidate({ base: { lat: 40.7, lng: -74.0 }, maxTravelMiles: 25 }); // NYC
    const r = matchCandidate(REQUEST, c, NOW);
    expect(r.misses).toContain("too_far");
    expect(r.distanceMiles).toBeGreaterThan(1000);
  });

  it("excludes a request below the practitioner's pay floor", () => {
    expect(matchCandidate(REQUEST, candidate({ minPayCents: 10000 }), NOW).misses).toContain(
      "below_pay",
    );
  });

  it("matches with no distance when the practitioner has no location", () => {
    const r = matchCandidate(REQUEST, candidate({ base: null }), NOW);
    expect(r.matches).toBe(true);
    expect(r.distanceMiles).toBeNull();
  });
});

describe("rankCandidates", () => {
  it("returns only matches, closest and most-experienced first", () => {
    const near = candidate({ practitionerId: "near", base: { lat: 37.5, lng: -122.301 } });
    const far = candidate({ practitionerId: "far", base: { lat: 37.9, lng: -122.0 } });
    const ineligible = candidate({ practitionerId: "no", availableForWork: false });
    const ranked = rankCandidates(REQUEST, [far, ineligible, near], NOW);
    expect(ranked.map((r) => r.candidate.practitionerId)).toEqual(["near", "far"]);
  });
});
