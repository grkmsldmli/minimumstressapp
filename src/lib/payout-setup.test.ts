/**
 * The state a boolean had no room for.
 *
 * `stripeConnected` was true or false, derived from
 * `stripe_connect_charges_enabled` alone. But there are hours between a host
 * submitting Stripe's form — where the last thing they are told is "we'll
 * review your application" — and the account.updated webhook enabling the
 * account. In that window the flag is false, so the screen said "Payouts not
 * set up" and offered a button to start again: it reads as though the
 * submission was lost, and invites somebody to do the whole thing twice.
 *
 * The account id is what separates the two. It is written the moment an
 * account is created and nothing else clears it.
 */

import { describe, expect, it } from "vitest";

import { payoutSetupFrom } from "./payout-setup";

describe("payoutSetupFrom", () => {
  it("is not_started before there is an account at all", () => {
    expect(
      payoutSetupFrom({
        stripe_connect_account_id: null,
        stripe_connect_charges_enabled: false,
      }),
    ).toBe("not_started");
  });

  it("is in_review once the form is submitted and Stripe has not finished", () => {
    expect(
      payoutSetupFrom({
        stripe_connect_account_id: "acct_1U3P0i",
        stripe_connect_charges_enabled: false,
      }),
    ).toBe("in_review");
  });

  it("is ready only once Stripe says money can move", () => {
    expect(
      payoutSetupFrom({
        stripe_connect_account_id: "acct_1U3P0i",
        stripe_connect_charges_enabled: true,
      }),
    ).toBe("ready");
  });

  /*
   * charges_enabled is set by the webhook and never by our own routes, so
   * trusting it over a missing id is right: an account whose row lost its id
   * can still be paid, and telling that host to start again would create a
   * second account and strand the first.
   */
  it("trusts the webhook's answer even without an id beside it", () => {
    expect(
      payoutSetupFrom({
        stripe_connect_account_id: null,
        stripe_connect_charges_enabled: true,
      }),
    ).toBe("ready");
  });
});
