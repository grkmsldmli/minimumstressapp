import { NextResponse, type NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
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
async function linkFor(request: NextRequest, userId: string, email: string | null) {
  const admin = supabaseAdmin();

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", userId)
    .maybeSingle();

  // Reuse the account if one exists. Creating a second would strand whatever
  // verification the host already completed on the first.
  let accountId = profile?.stripe_connect_account_id ?? null;

  if (!accountId) {
    accountId = await createConnectedAccount(email);
    await admin.from("profiles").upsert({ id: userId, stripe_connect_account_id: accountId });
  }

  const origin = request.nextUrl.origin;
  return createOnboardingLink(
    accountId,
    `${origin}/host/payouts/done`,
    // Stripe sends the host here if the link expired before they finished.
    // It has to start onboarding again, not dead-end on an error page.
    `${origin}/api/connect/onboard`,
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("connect", identify(request, auth.user.id), LIMITS.connect);
    if (!limited.ok) return tooManyRequests(limited);

    return Response.json({ url: await linkFor(request, auth.user.id, auth.user.email ?? null) });
  });
}

/**
 * The same thing, for Stripe rather than for our own screen.
 *
 * `refresh_url` above points here and is followed by a browser, which means a
 * GET. Until this existed the route was POST-only, so the one case the comment
 * promised to handle — a link that expired before the host finished — landed
 * on a 405 with no way forward. Onboarding links are short-lived by design, so
 * this is the ordinary path, not an edge.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireUser();
  // Signed out by the time they came back. Home, where they can sign in again,
  // rather than a JSON error in a browser window.
  if ("response" in auth) return NextResponse.redirect(new URL("/", request.nextUrl.origin));

  const limited = check("connect", identify(request, auth.user.id), LIMITS.connect);
  if (!limited.ok) return tooManyRequests(limited);

  try {
    const url = await linkFor(request, auth.user.id, auth.user.email ?? null);
    return NextResponse.redirect(url);
  } catch (failure) {
    console.error("Could not rebuild an onboarding link:", failure);
    return NextResponse.redirect(new URL("/host/payouts/done", request.nextUrl.origin));
  }
}
