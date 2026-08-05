import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { billingPortal, customerFor, startSubscription } from "@/lib/stripe/subscription";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Starting or managing the Pro subscription.
 *
 * One route, two directions, because they are the same decision from the
 * person's point of view — "deal with my subscription" — and which one they
 * get depends on whether they already have one. Working that out here rather
 * than asking the client means a client cannot ask for the checkout while
 * already subscribed and end up paying twice.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("pro", identify(request, auth.user.id), LIMITS.pro);
    if (!limited.ok) return tooManyRequests(limited);

    const admin = supabaseAdmin();

    const { data: profile, error } = await admin
      .from("profiles")
      .select("stripe_customer_id, is_pro")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (error) throw error;

    const customerId = await customerFor(
      auth.user.id,
      auth.user.email ?? null,
      profile?.stripe_customer_id ?? null,
    );

    // Stored before the redirect, so a person who abandons checkout and comes
    // back is the same customer rather than a second one.
    if (customerId !== profile?.stripe_customer_id) {
      const { error: saveError } = await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", auth.user.id);
      if (saveError) throw saveError;
    }

    const origin = request.nextUrl.origin;

    /**
     * Already Pro means the portal, not the checkout.
     *
     * Sending a subscriber to checkout would let them buy a second
     * subscription — Stripe does not stop it, and neither would a client that
     * simply asked for whichever screen it felt like.
     */
    const url = profile?.is_pro
      ? await billingPortal(customerId, origin)
      : await startSubscription({ customerId, userId: auth.user.id, origin });

    return Response.json({ url });
  });
}

export async function GET(): Promise<Response> {
  return jsonError("Use POST", 405);
}
