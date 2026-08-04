import "server-only";

import Stripe from "stripe";

import type { BookingMoney } from "../money";
import { PAYOUT_DELAY_DAYS, payoutStatus, type PayoutStatus } from "../payouts";
import { BOOKING_PAYMENT_METHODS } from "./payment-methods";
import { planPaymentIntent, type SettlementAction } from "./payments";

/**
 * Server-side Stripe. `server-only` at the top makes importing this from a
 * client component a build error rather than a leaked secret key.
 */
let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set — see .env.example");
    }
    cached = new Stripe(key);
  }
  return cached;
}

/* ------------------------------------------------------------------ */
/*  Connect — host onboarding                                          */
/* ------------------------------------------------------------------ */

/**
 * Create the host's connected account.
 *
 * Express, so Stripe hosts the identity and bank collection. We never see a
 * bank number, which is both the brief's instruction and the reason this is
 * the only sensible option: holding that data would drag the whole app into a
 * compliance scope it has no business being in.
 */
export async function createConnectedAccount(email: string | null): Promise<string> {
  const account = await stripe().accounts.create({
    type: "express",
    email: email ?? undefined,
    business_type: "individual",
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    settings: {
      payouts: {
        // Daily on a rolling delay, rather than Stripe's weekly default.
        // A host earning on Tuesday should not wait until the following
        // Friday; the protection comes from the delay and from capture
        // happening at session start, not from batching.
        schedule: { interval: "daily", delay_days: PAYOUT_DELAY_DAYS },
      },
    },
  });
  return account.id;
}

/** Where a host stands, asked of Stripe rather than inferred from our own rows. */
export async function readPayoutStatus(accountId: string): Promise<PayoutStatus> {
  const account = await stripe().accounts.retrieve(accountId);
  return payoutStatus({
    hasAccount: true,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    // Stripe sets this when a deadline has passed and the account is limited —
    // distinct from simply not having finished yet.
    hasOverdueRequirements: (account.requirements?.currently_due?.length ?? 0) > 0
      && Boolean(account.requirements?.current_deadline),
  });
}

/** A one-time link into Stripe's hosted onboarding. Expires quickly by design. */
export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url;
}

/**
 * Whether this account can actually be paid.
 *
 * `payouts_enabled` is the honest signal, not "the host clicked through the
 * form". Someone can abandon Stripe's flow halfway and come back looking
 * finished; marking them connected then would let them take bookings for money
 * that can never reach them.
 */
export async function accountCanReceiveMoney(accountId: string): Promise<boolean> {
  const account = await stripe().accounts.retrieve(accountId);
  return Boolean(account.payouts_enabled && account.charges_enabled);
}

/* ------------------------------------------------------------------ */
/*  Payments                                                           */
/* ------------------------------------------------------------------ */

export interface AuthorizeResult {
  paymentIntentId: string;
  clientSecret: string;
}

/**
 * Authorise, do not charge.
 *
 * The idempotency key is the booking id, so a retried request — a flaky
 * network, an impatient second tap — reuses the existing intent instead of
 * placing a second hold on the same card for the same hour.
 */
export async function authorizeBooking(
  money: BookingMoney,
  hostStripeAccountId: string,
  meta: { bookingId: string; spaceId: string; practitionerId: string },
  customerId?: string,
): Promise<AuthorizeResult> {
  const plan = planPaymentIntent(money, hostStripeAccountId, meta);

  const intent = await stripe().paymentIntents.create(
    {
      amount: plan.amount,
      currency: plan.currency,
      capture_method: plan.capture_method,
      transfer_data: plan.transfer_data,
      application_fee_amount: plan.application_fee_amount,
      metadata: plan.metadata,
      customer: customerId,
      // Not automatic_payment_methods — see payment-methods.ts for why.
      payment_method_types: [...BOOKING_PAYMENT_METHODS],
    },
    { idempotencyKey: `booking_authorize_${meta.bookingId}` },
  );

  if (!intent.client_secret) {
    throw new Error(`PaymentIntent ${intent.id} has no client secret`);
  }
  return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
}

/** Run whatever a cancellation or a session start decided should happen. */
export async function settle(
  paymentIntentId: string,
  action: SettlementAction,
): Promise<void> {
  switch (action.kind) {
    case "capture":
      await stripe().paymentIntents.capture(paymentIntentId, {
        amount_to_capture: action.amountCents,
      });
      return;

    case "void":
      await stripe().paymentIntents.cancel(paymentIntentId);
      return;

    case "refund":
      // reverse_transfer pulls the host's share back out of their balance too.
      // Without it a host cancellation refunds the practitioner from our
      // account while the host keeps the money.
      await stripe().refunds.create({
        payment_intent: paymentIntentId,
        amount: action.amountCents,
        reverse_transfer: true,
        refund_application_fee: true,
      });
      return;

    case "none":
      return;
  }
}
