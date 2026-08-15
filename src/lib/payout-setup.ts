import type { PayoutSetup } from "./domain";

/**
 * Where payout setup stands, from the two columns that record it.
 *
 * This was a boolean read straight off `stripe_connect_charges_enabled`, which
 * had no room for the hours between a host submitting Stripe's form — where
 * the last thing they are told is "we'll review your application" — and the
 * account.updated webhook enabling the account. In that window the flag is
 * false, so the screen said "Payouts not set up" and offered a button to start
 * again: it reads as though the submission was lost, and invites somebody to
 * do the whole thing twice.
 *
 * The account id is what separates the two. It is written the moment an
 * account is created, and only onboarding replaces it.
 *
 * charges_enabled wins where they disagree. It is set by the webhook and never
 * by our own routes, so it is the one field here that reflects Stripe rather
 * than us — and sending a host who can already be paid back through onboarding
 * would create a second account and strand the first.
 */
export function payoutSetupFrom(row: {
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
}): PayoutSetup {
  if (row.stripe_connect_charges_enabled) return "ready";
  return row.stripe_connect_account_id ? "in_review" : "not_started";
}
