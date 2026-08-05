import { PRO_PRICE_CENTS } from "../money";
import { stripe } from "./client";

/**
 * The Pro subscription.
 *
 * Hosted Checkout rather than the embedded Payment Element, which is a
 * deliberate departure from how booking works. The booking sheet is embedded
 * because the itemised All In Price has to sit beside the card fields — that
 * is the whole point of it. A subscription is one recurring charge with no
 * breakdown to show, and hosted Checkout brings SCA, 3D Secure, card updates
 * and dunning that would otherwise all have to be built and none of which
 * would be better for having been.
 *
 * Nothing here marks anybody Pro. That happens in the webhook, once Stripe
 * says the money cleared — a flag set on redirect is a flag set by anyone who
 * can reach the success URL.
 */

const PRICE_LOOKUP_KEY = "minimum_stress_pro_monthly";

/**
 * Finds the recurring price, creating it once if it is not there.
 *
 * Looked up by key rather than hardcoded as an id, so the same code works
 * against a test account and a live one without an environment variable that
 * somebody has to remember to set. The amount comes from `money.ts`, which is
 * the only place the price is written down.
 */
export async function proPriceId(): Promise<string> {
  const existing = await stripe().prices.list({
    lookup_keys: [PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });

  if (existing.data[0]) return existing.data[0].id;

  const price = await stripe().prices.create({
    lookup_key: PRICE_LOOKUP_KEY,
    currency: "usd",
    unit_amount: PRO_PRICE_CENTS,
    recurring: { interval: "month" },
    product_data: {
      name: "Minimum Stress Pro",
    },
  });

  return price.id;
}

/**
 * A customer per account, reused.
 *
 * Without the reuse a second subscription attempt creates a second customer,
 * and the account ends up with two payment histories that neither support nor
 * the person can reconcile.
 */
export async function customerFor(
  userId: string,
  email: string | null,
  existingId: string | null,
): Promise<string> {
  if (existingId) return existingId;

  const customer = await stripe().customers.create({
    email: email ?? undefined,
    // The link back. Without it a Stripe dashboard row is an anonymous card.
    metadata: { app_user_id: userId },
  });

  return customer.id;
}

/** Where Stripe sends somebody to pay, and where it returns them afterwards. */
export async function startSubscription(input: {
  customerId: string;
  userId: string;
  origin: string;
}): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items: [{ price: await proPriceId(), quantity: 1 }],

    // Carried through to the webhook, which is what turns a completed payment
    // into a Pro flag on the right row.
    subscription_data: { metadata: { app_user_id: input.userId } },
    metadata: { app_user_id: input.userId },

    success_url: `${input.origin}/?pro=started`,
    cancel_url: `${input.origin}/?pro=cancelled`,
  });

  if (!session.url) throw new Error("Stripe returned a checkout session with no URL");
  return session.url;
}

/**
 * The billing portal: cancelling, changing a card, downloading receipts.
 *
 * Stripe's own, rather than a cancel button of ours. Somebody trying to stop
 * paying should not have to get past a screen we designed, and a portal that
 * also shows their invoices answers the question they usually actually have.
 */
export async function billingPortal(customerId: string, origin: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/`,
  });

  return session.url;
}

/**
 * Whether a subscription status means the person is entitled right now.
 *
 * `past_due` counts. A card that failed on renewal is somebody Stripe is still
 * retrying, and cutting the benefit off at the first failed attempt punishes
 * an expired card as though it were a cancellation. `unpaid` is where Stripe
 * has given up, and that is where we do too.
 */
export function grantsPro(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}
