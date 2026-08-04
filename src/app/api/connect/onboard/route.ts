import type { NextRequest } from "next/server";

import { handled, requireUser } from "@/lib/api/session";
import { createConnectedAccount, createOnboardingLink } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Start (or resume) payout onboarding for a host.
 *
 * Returns a one-time link into Stripe's hosted flow, which is where bank
 * details and identity documents are collected. We never see either, which is
 * the point of Express — holding that data would pull the whole app into a
 * compliance scope it has no reason to be in.
 *
 * Note what this route does *not* do: it never sets
 * `stripe_connect_charges_enabled`. Someone can open the form, fill in half of
 * it and come back, and marking them connected here would let them take
 * bookings for money that can never reach them. Only the `account.updated`
 * webhook flips that, and only once Stripe says payouts are genuinely enabled.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const admin = supabaseAdmin();

    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", auth.user.id)
      .maybeSingle();

    // Reuse the account if one exists. Creating a second would strand whatever
    // verification the host already completed on the first.
    let accountId = profile?.stripe_connect_account_id ?? null;

    if (!accountId) {
      accountId = await createConnectedAccount(auth.user.email ?? null);
      await admin
        .from("profiles")
        .upsert({ id: auth.user.id, stripe_connect_account_id: accountId });
    }

    const origin = request.nextUrl.origin;
    const url = await createOnboardingLink(
      accountId,
      `${origin}/host/payouts/done`,
      // Stripe sends the host here if the link expired before they finished.
      // It has to start onboarding again, not dead-end on an error page.
      `${origin}/api/connect/onboard`,
    );

    return Response.json({ url });
  });
}
