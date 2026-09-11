import { describe, expect, it } from "vitest";

import type { BoardFilters } from "./domain";
import { passesFilters } from "./work/board-filters";

/**
 * The board's only narrowing. These prove the filters behave as filters — an
 * AND of what the practitioner set, never a ranking or a hidden exclusion — and
 * that an absent filter matches everything. The caller never runs this against a
 * row the practitioner is engaged with, so an application in flight is never
 * filtered away; that is asserted in the service, not here.
 */

// A permissive base row; each test overrides only what it exercises.
const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    host_id: "h1",
    profession: "yoga",
    session_format: "group",
    level: "All levels",
    pay_cents: 6000,
    urgent: false,
    starts_at: new Date("2026-10-10T18:00:00Z").toISOString(),
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const pass = (f: BoardFilters, over: Record<string, unknown> = {}) => passesFilters(row(over), f);

describe("passesFilters", () => {
  it("an empty filter matches every row", () => {
    expect(pass({})).toBe(true);
  });

  it("profession filters exactly, not by adjacency", () => {
    expect(pass({ profession: "yoga" })).toBe(true);
    expect(pass({ profession: "pilates" })).toBe(false);
  });

  it("session format and level filter exactly", () => {
    expect(pass({ sessionFormat: "group" })).toBe(true);
    expect(pass({ sessionFormat: "private" })).toBe(false);
    expect(pass({ level: "All levels" })).toBe(true);
    expect(pass({ level: "Advanced" })).toBe(false);
  });

  it("minimum pay is a floor, inclusive", () => {
    expect(pass({ minPayCents: 6000 }, { pay_cents: 6000 })).toBe(true);
    expect(pass({ minPayCents: 6001 }, { pay_cents: 6000 })).toBe(false);
    expect(pass({ minPayCents: 5000 }, { pay_cents: 6000 })).toBe(true);
  });

  it("urgentOnly keeps only urgent rows; off keeps both", () => {
    expect(pass({ urgentOnly: true }, { urgent: true })).toBe(true);
    expect(pass({ urgentOnly: true }, { urgent: false })).toBe(false);
    expect(pass({ urgentOnly: false }, { urgent: false })).toBe(true);
  });

  it("the date window bounds the start, inclusive on both ends", () => {
    const start = new Date("2026-10-10T18:00:00Z");
    expect(pass({ onOrAfter: start }, { starts_at: start.toISOString() })).toBe(true);
    expect(pass({ onOrAfter: new Date(start.getTime() + 1) }, { starts_at: start.toISOString() })).toBe(
      false,
    );
    expect(pass({ onOrBefore: start }, { starts_at: start.toISOString() })).toBe(true);
    expect(pass({ onOrBefore: new Date(start.getTime() - 1) }, { starts_at: start.toISOString() })).toBe(
      false,
    );
  });

  it("multiple filters are ANDed — every one must pass", () => {
    const f: BoardFilters = { profession: "yoga", sessionFormat: "group", minPayCents: 5000 };
    expect(pass(f)).toBe(true);
    expect(pass(f, { profession: "pilates" })).toBe(false);
    expect(pass(f, { pay_cents: 4000 })).toBe(false);
  });
});
