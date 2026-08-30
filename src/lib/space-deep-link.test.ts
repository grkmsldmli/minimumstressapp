// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { idFromSlug, listingSlug } from "./listing-url";
import {
  clearPendingSpace,
  readPendingSpace,
  readSpaceDeepLink,
  resolveSpaceDeepLink,
  writePendingSpace,
} from "./space-deep-link";

/**
 * The ?space= deep link's rules, tested where they live rather than through the
 * shell. Public listing pages redirect to APP_URL?space=<id>, where the id is
 * only the first eight hex characters of the UUID (all listingSlug ever emits);
 * the shell opens Detail only when that prefix matches exactly one listing this
 * user already loaded — never fetched anonymously to resolve — and carries the
 * intent across an OAuth reload.
 */

// Two listings whose ids share an eight-character prefix, for the collision case.
const SHARED_PREFIX = "4e313239";
const A = `${SHARED_PREFIX}-0000-4000-8000-000000000000`;
const B = `${SHARED_PREFIX}-ffff-4fff-8fff-ffffffffffff`;
const MINE = "abcdef01-1234-4000-8000-000000000000";

describe("reading the deep link from a URL", () => {
  it("finds the space id", () => {
    expect(readSpaceDeepLink("?space=4e313239")).toBe("4e313239");
  });

  it("is null when there is no space parameter", () => {
    expect(readSpaceDeepLink("?ref=friend&pro=1")).toBeNull();
    expect(readSpaceDeepLink("")).toBeNull();
  });

  it("treats a blank value as no request", () => {
    expect(readSpaceDeepLink("?space=")).toBeNull();
    expect(readSpaceDeepLink("?space=%20%20")).toBeNull();
  });
});

describe("resolving an eight-character prefix to a full listing id", () => {
  it("resolves the real public-URL flow to the full UUID", () => {
    // The exact chain a public listing page takes: full id → slug → the eight
    // characters the URL carries → ?space=<prefix> → matched against the full
    // UUID already in the signed-in catalogue.
    const slug = listingSlug("Bright Pilates Studio", A);
    const prefix = idFromSlug(slug);
    expect(prefix).toBe(SHARED_PREFIX);

    const pending = readSpaceDeepLink(`?space=${prefix}`);
    expect(resolveSpaceDeepLink(pending, [[{ id: A }], []])).toBe(A);
  });

  it("refuses a prefix that matches more than one listing", () => {
    // A and B share the eight-character prefix; guessing between them would open
    // the wrong room, so it opens neither.
    const prefix = idFromSlug(listingSlug("Studio", A));
    expect(resolveSpaceDeepLink(prefix, [[{ id: A }, { id: B }], []])).toBeNull();
  });

  it("falls back to Discover when nothing matches", () => {
    expect(resolveSpaceDeepLink("deadbeef", [[{ id: A }], []])).toBeNull();
  });

  it("still accepts a full UUID directly", () => {
    expect(resolveSpaceDeepLink(A, [[{ id: A }], []])).toBe(A);
  });

  it("opens the user's own listing by prefix", () => {
    expect(resolveSpaceDeepLink("abcdef01", [[], [{ id: MINE }]])).toBe(MINE);
  });

  it("treats one listing in both lists as a single match, not a collision", () => {
    // A host's own live room can appear in the public catalogue and in mySpaces;
    // deduping by id keeps that a single match rather than a false tie.
    expect(resolveSpaceDeepLink("abcdef01", [[{ id: MINE }], [{ id: MINE }]])).toBe(MINE);
  });

  it("ignores a value that is neither an 8- nor 32-hex target", () => {
    expect(resolveSpaceDeepLink("4e", [[{ id: A }], []])).toBeNull();
    expect(resolveSpaceDeepLink("not-hex!", [[{ id: A }], []])).toBeNull();
    expect(resolveSpaceDeepLink(null, [[{ id: A }], []])).toBeNull();
  });
});

describe("persisting the intent across an OAuth reload", () => {
  beforeEach(() => window.localStorage.clear());

  it("writes and reads back the pending id", () => {
    writePendingSpace(SHARED_PREFIX);
    expect(readPendingSpace()).toBe(SHARED_PREFIX);
  });

  it("clears it once consumed", () => {
    writePendingSpace(SHARED_PREFIX);
    clearPendingSpace();
    expect(readPendingSpace()).toBeNull();
  });

  it("expires and clears a stale intent past the TTL", () => {
    const t0 = 1_000_000;
    writePendingSpace(SHARED_PREFIX, t0);

    // Well inside the window an OAuth round trip needs.
    expect(readPendingSpace(t0 + 9 * 60_000)).toBe(SHARED_PREFIX);
    // Past it — returned null and the stale entry removed.
    expect(readPendingSpace(t0 + 11 * 60_000)).toBeNull();
    expect(window.localStorage.getItem("ms_pending_space")).toBeNull();
  });

  it("tolerates a malformed stored value", () => {
    window.localStorage.setItem("ms_pending_space", "{ not json");
    expect(readPendingSpace()).toBeNull();
  });
});
