/**
 * An account id that outlived the key that made it.
 *
 * Connected accounts belong to the platform key that created them. Rotate to a
 * different Stripe account and every stored id becomes a dead pointer: Stripe
 * answers 403 StripePermissionError / account_invalid to the payout link, the
 * onboarding link and the balance alike.
 *
 * That shut both ways back at once — onboarding reused the same stored id — so
 * a host could never be paid, while the settings screen went on saying
 * "Stripe · connected" and every tap arrived as a bare 500.
 *
 * The error shapes below were read off the real API, not guessed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const retrieve = vi.fn();

// client.ts is server-only, which is a build-time guard rather than anything
// the function under test needs.
vi.mock("server-only", () => ({}));

vi.mock("stripe", () => ({
  default: class {
    accounts = { retrieve };
  },
}));

vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_pretend");

const { accountIsReachable } = await import("./client");

afterEach(() => retrieve.mockReset());

/** What the Stripe node SDK throws. Only these three fields are read. */
function stripeError(fields: { type?: string; code?: string; statusCode?: number }) {
  return Object.assign(new Error("The provided key does not have access to that account"), fields);
}

describe("accountIsReachable", () => {
  it("says yes for an account this key can retrieve", async () => {
    retrieve.mockResolvedValue({ id: "acct_live", charges_enabled: true });
    await expect(accountIsReachable("acct_live")).resolves.toBe(true);
  });

  /* Observed against the real API: type StripePermissionError, code
     account_invalid, statusCode 403 — for both a foreign account and one that
     never existed. */
  it("says no when the key has no access to it", async () => {
    retrieve.mockRejectedValue(
      stripeError({ type: "StripePermissionError", code: "account_invalid", statusCode: 403 }),
    );
    await expect(accountIsReachable("acct_orphaned")).resolves.toBe(false);
  });

  it("says no when Stripe has no such resource", async () => {
    retrieve.mockRejectedValue(
      stripeError({ type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 }),
    );
    await expect(accountIsReachable("acct_gone")).resolves.toBe(false);
  });

  /*
   * The important half. A dropped connection is not an answer about the
   * account, and callers treat false as "throw this id away and make a new
   * one" — so answering false here would destroy a good account over a blip.
   */
  it("refuses to answer when the failure says nothing about the account", async () => {
    retrieve.mockRejectedValue(
      stripeError({ type: "StripeConnectionError", statusCode: 500 }),
    );
    await expect(accountIsReachable("acct_live")).rejects.toThrow();
  });

  it("refuses to answer when the key itself is wrong", async () => {
    // Every id would look unreachable, and every host would be re-onboarded.
    retrieve.mockRejectedValue(
      stripeError({ type: "StripeAuthenticationError", statusCode: 401 }),
    );
    await expect(accountIsReachable("acct_live")).rejects.toThrow();
  });
});
