import type Stripe from "stripe";

import { PRO_PRICE_CENTS, STUDIO_PRO_PRICE_CENTS } from "../money";
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

/** A stable, forever 50%-off coupon for Founding Practitioners, created once —
 *  the practitioner-side twin of the Founding-Host coupon below. Distinct id and
 *  name so the two can never be confused, though both are percent_off:50 forever. */
const FOUNDING_PRACTITIONER_COUPON_ID = "founding_practitioner_pro_50";

/**
 * The Founding-Practitioner discount, tied to the benefit rather than to one
 * subscription — so it survives cancel and applies again on resubscribe. Percent
 * based and forever, so it tracks the applicable Pro list price even if that
 * price later changes.
 */
async function foundingPractitionerCouponId(): Promise<string> {
  try {
    return (await stripe().coupons.retrieve(FOUNDING_PRACTITIONER_COUPON_ID)).id;
  } catch {
    const coupon = await stripe().coupons.create({
      id: FOUNDING_PRACTITIONER_COUPON_ID,
      percent_off: 50,
      duration: "forever",
      name: "Founding Practitioner — 50% off Pro",
    });
    return coupon.id;
  }
}

/**
 * Where Stripe sends somebody to pay, and where it returns them afterwards.
 *
 * `trialEndUnix` (seconds) is set only for a Founding Practitioner who subscribes
 * while still inside their free window, so Stripe charges nothing until then.
 * Founding Practitioners carry the 50% coupon (applied to the recurring charge
 * after any trial), which belongs to the benefit and applies again on resubscribe.
 * No card is ever collected outside this deliberate, opted-in flow.
 */
export async function startSubscription(input: {
  customerId: string;
  userId: string;
  origin: string;
  foundingDiscount?: boolean;
  trialEndUnix?: number;
}): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items: [{ price: await proPriceId(), quantity: 1 }],

    // Carried through to the webhook, which is what turns a completed payment
    // into a Pro flag on the right row. `founding_discount` is stamped only when
    // the coupon is actually applied, so the webhook can tell — reliably, from
    // metadata present on every event including deletion — that THIS subscription
    // was the founding-discounted one and forfeit the 50% right when it ends.
    subscription_data: {
      metadata: {
        app_user_id: input.userId,
        ...(input.foundingDiscount ? { founding_discount: "true" } : {}),
      },
      ...(input.trialEndUnix ? { trial_end: input.trialEndUnix } : {}),
    },
    metadata: { app_user_id: input.userId },
    ...(input.foundingDiscount
      ? { discounts: [{ coupon: await foundingPractitionerCouponId() }] }
      : {}),

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

/* ------------------------------------------------------------------ */
/*  Studio Pro — the host-account subscription                          */
/*                                                                     */
/*  Mirrors practitioner Pro above and rides the SAME Stripe customer.  */
/*  It is disambiguated from practitioner Pro by subscription metadata  */
/*  (kind: "studio_pro") so the webhook writes profiles.studio_pro,     */
/*  never is_pro. Founding-Host benefits: the free six months are a     */
/*  DERIVED entitlement (lib/entitlements) with no Stripe subscription  */
/*  and no card — so they are NOT modelled here; only voluntary         */
/*  continuation goes through checkout, where a founding host still in   */
/*  their free window gets trial_end = free_until (so no charge before   */
/*  it ends) and every founding host gets the lifetime 50% coupon.      */
/* ------------------------------------------------------------------ */

const STUDIO_PRO_PRICE_LOOKUP_KEY = "minimum_stress_studio_pro_monthly";

/** A stable, forever 50%-off coupon for Founding Hosts, created once. */
const FOUNDING_HOST_COUPON_ID = "founding_host_studio_50";

export async function studioProPriceId(): Promise<string> {
  const existing = await stripe().prices.list({
    lookup_keys: [STUDIO_PRO_PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0].id;

  const price = await stripe().prices.create({
    lookup_key: STUDIO_PRO_PRICE_LOOKUP_KEY,
    currency: "usd",
    unit_amount: STUDIO_PRO_PRICE_CENTS,
    recurring: { interval: "month" },
    product_data: { name: "Minimum Stress Studio Pro" },
  });
  return price.id;
}

/**
 * The Founding-Host discount, as a coupon tied to the benefit rather than to one
 * subscription — so it survives cancel and applies again on resubscribe. Created
 * once with a fixed id; percent-based and forever, so it tracks the applicable
 * Studio Pro list price even if that price later changes.
 */
async function foundingHostCouponId(): Promise<string> {
  try {
    return (await stripe().coupons.retrieve(FOUNDING_HOST_COUPON_ID)).id;
  } catch {
    const coupon = await stripe().coupons.create({
      id: FOUNDING_HOST_COUPON_ID,
      percent_off: 50,
      duration: "forever",
      name: "Founding Host — 50% off Studio Pro",
    });
    return coupon.id;
  }
}

/**
 * Start (or continue) a Studio Pro subscription via hosted Checkout.
 *
 * `trialEndUnix` (seconds) is set only for a founding host who subscribes while
 * still inside their free window, so Stripe charges nothing until then. Founding
 * hosts always carry the 50% coupon (applied to the recurring charge after any
 * trial). No card is ever collected outside this deliberate, opted-in flow.
 */
export async function startStudioProSubscription(input: {
  customerId: string;
  userId: string;
  origin: string;
  foundingDiscount: boolean;
  trialEndUnix?: number;
}): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    line_items: [{ price: await studioProPriceId(), quantity: 1 }],
    subscription_data: {
      // `kind` is what the webhook branches on so this never touches is_pro.
      // `founding_discount` marks this as the discounted sub, so its terminal end
      // forfeits the Founding-Host 50% right (and a full-price resubscribe's end
      // does not).
      metadata: {
        app_user_id: input.userId,
        kind: "studio_pro",
        ...(input.foundingDiscount ? { founding_discount: "true" } : {}),
      },
      ...(input.trialEndUnix ? { trial_end: input.trialEndUnix } : {}),
    },
    metadata: { app_user_id: input.userId, kind: "studio_pro" },
    ...(input.foundingDiscount ? { discounts: [{ coupon: await foundingHostCouponId() }] } : {}),
    success_url: `${input.origin}/?studiopro=started`,
    cancel_url: `${input.origin}/?studiopro=cancelled`,
  });

  if (!session.url) throw new Error("Stripe returned a checkout session with no URL");
  return session.url;
}

/** Whether a subscription is the Studio Pro one — by metadata, then price key. */
export function isStudioProSubscription(sub: Stripe.Subscription): boolean {
  if (sub.metadata?.kind === "studio_pro") return true;
  return sub.items.data.some((i) => i.price?.lookup_key === STUDIO_PRO_PRICE_LOOKUP_KEY);
}
