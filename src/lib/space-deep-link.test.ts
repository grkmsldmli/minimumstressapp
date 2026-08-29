import { describe, expect, it } from "vitest";

import { readSpaceDeepLink, resolveSpaceDeepLink } from "./space-deep-link";

/**
 * The ?space= deep link's two rules, tested where they live rather than through
 * the shell. Public listing pages redirect to APP_URL?space=<id>; the shell
 * captures the id and opens Detail only when it is a listing this user already
 * loaded — never fetched anonymously to resolve.
 */
describe("reading the deep link from a URL", () => {
  it("finds the space id", () => {
    expect(readSpaceDeepLink("?space=abc123")).toBe("abc123");
  });

  it("is null when there is no space parameter", () => {
    expect(readSpaceDeepLink("?ref=friend&pro=1")).toBeNull();
    expect(readSpaceDeepLink("")).toBeNull();
  });

  it("treats a blank value as no request", () => {
    expect(readSpaceDeepLink("?space=")).toBeNull();
    expect(readSpaceDeepLink("?space=%20%20")).toBeNull();
  });

  it("keeps the id it was given verbatim", () => {
    const id = "4e313239-0000-4000-8000-000000000000";
    expect(readSpaceDeepLink(`?space=${id}`)).toBe(id);
  });
});

describe("deciding whether to open the deep-linked listing", () => {
  const catalogue = [{ id: "public-1" }, { id: "public-2" }];
  const mine = [{ id: "mine-1" }];

  it("opens a listing that is in the public catalogue", () => {
    expect(resolveSpaceDeepLink("public-2", [catalogue, mine])).toBe("public-2");
  });

  it("opens the user's own listing", () => {
    expect(resolveSpaceDeepLink("mine-1", [catalogue, mine])).toBe("mine-1");
  });

  it("falls back to Discover for a removed or inaccessible listing", () => {
    // The id resolved to nothing this user loaded — no anonymous lookup, just a
    // null the shell reads as "stay on Discover".
    expect(resolveSpaceDeepLink("gone-9", [catalogue, mine])).toBeNull();
  });

  it("does nothing when there is no pending link", () => {
    expect(resolveSpaceDeepLink(null, [catalogue, mine])).toBeNull();
  });

  it("falls back when the catalogue is empty", () => {
    expect(resolveSpaceDeepLink("public-1", [[], []])).toBeNull();
  });
});
