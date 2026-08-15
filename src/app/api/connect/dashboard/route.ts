import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { createAccountUpdateLink } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * A host's way back into their own Stripe account.
 *
 * Onboarding was a one-way door: once a host finished, the app said "Stripe ·
 * connected" and offered nothing to tap. Everything that can go wrong with a
 * payout afterwards — a closed bank account, a new tax detail Stripe wants, a
 * payout that bounced — is fixed on Stripe's side, and there was no route to
 * it from here.
 *
 * The link is created per tap because these links are single-use and expire in
 * minutes. Storing one would hand out a stale key, and rendering one into the
 * page would put a bearer token in the browser history.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check(
      "payout-dashboard",
      identify(request, auth.user.id),
      LIMITS.payoutDashboard,
    );
    if (!limited.ok) return tooManyRequests(limited);

    const admin = supabaseAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", auth.user.id)
      .maybeSingle();

    // Nothing to open. Said plainly rather than as an error, because the
    // answer is to finish onboarding rather than to try this again.
    if (!profile?.stripe_connect_account_id) {
      return jsonError("There is no payout account to open yet", 409);
    }

    const origin = request.nextUrl.origin;
    return Response.json({
      url: await createAccountUpdateLink(
        profile.stripe_connect_account_id,
        `${origin}/host/payouts/done`,
        // Same as onboarding: an expired link has to start again rather than
        // dead-end, and that route now answers a browser's GET.
        `${origin}/api/connect/onboard`,
      ),
    });
  });
}
