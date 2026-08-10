import "server-only";

import Stripe from "stripe";

import type { BookingMoney } from "../money";
import { PAYOUT_DELAY_DAYS, payoutStatus, type PayoutStatus } from "../payouts";
import { BOOKING_PAYMENT_METHODS } from "./payment-methods";
import { planHostTransfer, planPaymentIntent, type SettlementAction } from "./payments";

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
 * Charge the practitioner for the booking.
 *
 * The host is not paid here and is not even named: the money lands in our
 * balance and is transferred to them once the session has happened. See
 * `payments.ts` for why the two are separate.
 *
 * The idempotency key is the booking id, so a retried request — a flaky
 * network, an impatient second tap — reuses the existing intent instead of
 * charging the same card twice for the same hour.
 */
export async function chargeBooking(
  money: BookingMoney,
  meta: { bookingId: string; spaceId: string; practitionerId: string },
  customerId?: string,
): Promise<AuthorizeResult> {
  const plan = planPaymentIntent(money, meta);

  const intent = await stripe().paymentIntents.create(
    {
      amount: plan.amount,
      currency: plan.currency,
      capture_method: plan.capture_method,
      transfer_group: plan.transfer_group,
      metadata: plan.metadata,
      customer: customerId,
      // Not automatic_payment_methods — see payment-methods.ts for why.
      payment_method_types: [...BOOKING_PAYMENT_METHODS],
    },
    { idempotencyKey: `booking_charge_${meta.bookingId}` },
  );

  if (!intent.client_secret) {
    throw new Error(`PaymentIntent ${intent.id} has no client secret`);
  }
  return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
}

/** Run whatever a cancellation decided should happen. */
export async function settle(
  paymentIntentId: string,
  action: SettlementAction,
): Promise<void> {
  switch (action.kind) {
    case "refund":
      /*
       * No reverse_transfer, and that is the point of holding the money
       * ourselves. Cancellation is only possible before the session, the
       * transfer only happens after it, so there is never a host balance to
       * claw back — the refund comes entirely out of what we are holding.
       */
      await stripe().refunds.create({
        payment_intent: paymentIntentId,
        amount: action.amountCents,
      });
      return;

    case "abandon":
      /*
       * Never paid, so nothing comes back — this only closes an intent that is
       * still waiting for a card. Cancelling an intent that has since been
       * paid would throw, which is the right failure: it would mean the state
       * we cancelled against was already stale.
       */
      await stripe().paymentIntents.cancel(paymentIntentId);
      return;

    case "none":
      return;
  }
}

/**
 * Pay a host for a session that has happened.
 *
 * Idempotent on the booking, because the sweep that calls this runs twice a day
 * and a transfer written twice is a host paid twice out of our balance.
 */
export async function payHost(
  money: BookingMoney,
  hostStripeAccountId: string,
  paymentIntentId: string,
  meta: { bookingId: string; spaceId: string; practitionerId: string },
): Promise<{ transferId: string }> {
  /*
   * The charge, not the intent. A transfer can only be funded by a charge, and
   * asking Stripe for it here rather than storing it keeps one source of truth
   * — the intent already knows, and a column of ours could disagree with it.
   */
  const intent = await stripe().paymentIntents.retrieve(paymentIntentId);
  const chargeId =
    typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;

  if (!chargeId) {
    throw new Error(`PaymentIntent ${paymentIntentId} has no charge to pay the host from`);
  }

  const plan = planHostTransfer(money, hostStripeAccountId, chargeId, meta);

  const transfer = await stripe().transfers.create(
    {
      amount: plan.amount,
      currency: plan.currency,
      destination: plan.destination,
      transfer_group: plan.transfer_group,
      source_transaction: plan.source_transaction,
      metadata: plan.metadata,
    },
    { idempotencyKey: `booking_payout_${meta.bookingId}` },
  );

  return { transferId: transfer.id };
}

/**
 * Gives money back after a refund request, and takes it from the right place.
 *
 * Cancellation refunds are simple because they happen before the session, so
 * the whole charge is still ours to return. A refund *request* comes after —
 * the host may already have been paid, and refunding the full amount from our
 * balance would mean paying for the host's mistake out of our own pocket.
 *
 * So when staff decide the host is at fault and the transfer has gone, it is
 * reversed first. The practitioner gets their money, the host loses a payment
 * for a session they got wrong, and we are not the ones absorbing it. Reversing
 * is deliberately a separate step from refunding: if the reversal fails the
 * refund does not happen either, rather than silently landing on us.
 */
export async function refundRequested(
  paymentIntentId: string,
  amountCents: number,
  hostTransferId: string | null,
  clawBackFromHost: number,
): Promise<{ refundedCents: number; reversedCents: number }> {
  if (amountCents <= 0) return { refundedCents: 0, reversedCents: 0 };

  let reversedCents = 0;
  if (hostTransferId && clawBackFromHost > 0) {
    const reversal = await stripe().transfers.createReversal(hostTransferId, {
      amount: clawBackFromHost,
    });
    reversedCents = reversal.amount;
  }

  const refund = await stripe().refunds.create({
    payment_intent: paymentIntentId,
    amount: amountCents,
  });

  return { refundedCents: refund.amount, reversedCents };
}
