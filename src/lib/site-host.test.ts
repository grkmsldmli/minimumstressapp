/**
 * Which of the two sites a request belongs to.
 *
 * Getting this wrong is not subtle in either direction: a false positive puts
 * the marketing homepage where a practitioner expects their bookings, and a
 * false negative serves the app to somebody who typed the .com.
 */

import { describe, expect, it } from "vitest";

import { isSharedPath, isSiteHost } from "./site-host";

describe("isSiteHost", () => {
  it("recognises the content site, with and without www", () => {
    expect(isSiteHost("minimumstress.com")).toBe(true);
    expect(isSiteHost("www.minimumstress.com")).toBe(true);
  });

  it("recognises the staging name the site is built on", () => {
    expect(isSiteHost("new.minimumstress.com")).toBe(true);
  });

  it("leaves the app alone", () => {
    expect(isSiteHost("minimumstress.app")).toBe(false);
    expect(isSiteHost("www.minimumstress.app")).toBe(false);
    expect(isSiteHost("localhost:3000")).toBe(false);
  });

  /** Vercel gives every deployment one, and it serves the app. */
  it("leaves preview deployments on the app", () => {
    expect(isSiteHost("minimumstressapp-git-main-x.vercel.app")).toBe(false);
  });

  it("ignores the port, which development has and production does not", () => {
    expect(isSiteHost("site.localhost:3000")).toBe(true);
    expect(isSiteHost("minimumstress.com:443")).toBe(true);
  });

  it("is case-insensitive, because a Host header need not be lowercase", () => {
    expect(isSiteHost("MinimumStress.com")).toBe(true);
  });

  it("says no when there is no host at all", () => {
    expect(isSiteHost(null)).toBe(false);
    expect(isSiteHost("")).toBe(false);
  });

  /*
   * The check is an exact set rather than a suffix match. Matching on a suffix
   * would also accept "evilminimumstress.com", and a Host header is chosen by
   * whoever is making the request.
   */
  it("does not match a hostname that merely ends in ours", () => {
    expect(isSiteHost("evilminimumstress.com")).toBe(false);
    expect(isSiteHost("minimumstress.com.attacker.test")).toBe(false);
  });
});

describe("isSharedPath", () => {
  it("keeps the API and the auth callback off the rewrite", () => {
    // The callback path is registered in the Google and Microsoft consoles;
    // rewriting it under /site would break sign-in on the content host.
    expect(isSharedPath("/auth/callback")).toBe(true);
    expect(isSharedPath("/api/connect/dashboard")).toBe(true);
    expect(isSharedPath("/_next/static/chunk.js")).toBe(true);
  });

  it("lets ordinary pages through to be rewritten", () => {
    expect(isSharedPath("/")).toBe(false);
    expect(isSharedPath("/articles")).toBe(false);
    expect(isSharedPath("/tools/sleep-score")).toBe(false);
  });

  /** "/apiary" is a page, not the API. The slash is what separates them. */
  it("does not treat a path that merely starts with the letters as the API", () => {
    expect(isSharedPath("/apiary")).toBe(false);
    expect(isSharedPath("/authors")).toBe(false);
  });
});
