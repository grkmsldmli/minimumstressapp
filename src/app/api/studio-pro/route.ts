import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { foundingHostFreeUntil, withinFoundingFreePeriod } from "@/lib/entitlements";
import { billingPortal, customerFor, startStudioProSubscription } from "@/lib/stripe/subscription";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Starting or managing Studio Pro — the host-account subscription.
 *
 * The host-side mirror of /api/pro: already subscribed → the Stripe billing
 * portal (cancel/reactivate/card/receipts); otherwise → hosted Checkout. A
 * Founding Host who subscribes while still inside their free six months gets a
 * trial to the end of that window (no charge before it), and every Founding Host
 * carries the lifetime 50% coupon — the discount belongs to the benefit, applied
 * again on any resubscribe.
 *
 * Nothing here marks anybody Studio Pro — that is the webhook, once Stripe says
 * the money cleared (or the trial began). The free six months themselves need no
 * checkout at all: they are derived in lib/entitlements from founding_host_at.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("studioPro", identify(request, auth.user.id), LIMITS.studioPro);
    if (!limited.ok) return tooManyRequests(limited);

    const admin = supabaseAdmin();

    const { data: profile, error } = await admin
      .from("profiles")
      .select("stripe_customer_id, studio_pro, account_type, founding_host_at")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (error) throw error;

    if (profile?.account_type !== "host") {
      return jsonError("Only a studio account can subscribe to Studio Pro.", 403);
    }

    const customerId = await customerFor(
      auth.user.id,
      auth.user.email ?? null,
      profile?.stripe_customer_id ?? null,
    );
    if (customerId !== profile?.stripe_customer_id) {
      const { error: saveError } = await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", auth.user.id);
      if (saveError) throw saveError;
    }

    const origin = request.nextUrl.origin;

    // Already subscribed → the portal, so a subscriber can never double-buy.
    if (profile?.studio_pro) {
      return Response.json({ url: await billingPortal(customerId, origin) });
    }

    const foundingHostAt = profile?.founding_host_at ? new Date(profile.founding_host_at) : null;
    const now = new Date();
    // Founding host still in the free window subscribing early → charge nothing
    // until the free period ends.
    const trialEndUnix =
      foundingHostAt && withinFoundingFreePeriod(foundingHostAt, now)
        ? Math.floor(foundingHostFreeUntil(foundingHostAt).getTime() / 1000)
        : undefined;

    const url = await startStudioProSubscription({
      customerId,
      userId: auth.user.id,
      origin,
      foundingDiscount: foundingHostAt !== null,
      trialEndUnix,
    });
    return Response.json({ url });
  });
}

export async function GET(): Promise<Response> {
  return jsonError("Use POST", 405);
}
