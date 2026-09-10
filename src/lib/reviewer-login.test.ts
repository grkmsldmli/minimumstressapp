import { describe, expect, it } from "vitest";

import { REVIEWER_EMAIL, isReviewerEmail } from "./reviewer-login";

/**
 * The screen routes on this one boolean: false sends a code, true asks for a
 * password. So these tests are really about who gets which front door.
 */
describe("isReviewerEmail", () => {
  it("sends ordinary addresses down the emailed-code path", () => {
    // Every one of these is "not the reviewer", which is the whole point: the
    // passwordless flow is unchanged for anyone who is not this exact account.
    for (const email of [
      "someone@example.com",
      "minimum@gmail.com",
      "review@minimumstress.app",
      "minimumstress.reviewer@gmail.com",
      "minimumstress.review@gmail.co",
      "minimumstress.review+1@gmail.com",
      "",
    ]) {
      expect(isReviewerEmail(email)).toBe(false);
    }
  });

  it("recognises the reviewer address so it can ask for a password", () => {
    expect(isReviewerEmail(REVIEWER_EMAIL)).toBe(true);
  });

  it("still recognises it past the casing and spacing a paste introduces", () => {
    expect(isReviewerEmail("  minimumstress.review@gmail.com  ")).toBe(true);
    expect(isReviewerEmail("Minimumstress.Review@Gmail.com")).toBe(true);
  });

  it("keeps no password anywhere in the module", () => {
    // The address is public; a password would not be. Guard against anyone ever
    // parking one next to the email "for convenience".
    expect(REVIEWER_EMAIL).toBe("minimumstress.review@gmail.com");
    expect(REVIEWER_EMAIL).not.toMatch(/pass|pwd|secret|:/i);
  });
});
