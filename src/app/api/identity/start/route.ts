import { type NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, requireUser } from "@/lib/api/session";
import { createIdentitySession, retrieveIdentitySession } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Start a one-time identity check for the signed-in practitioner.
 *
 * Returns a link into Stripe's hosted Identity flow, where a government ID and a
 * selfie are collected — we never see either. Like Connect onboarding, this
 * route never marks anyone verified: it only opens the form and records the
 * session id. `identity_verified_at` is flipped by the
 * `identity.verification_session.verified` webhook and by nothing else, so a
 * form opened and abandoned leaves the practitioner exactly as unverified as
 * before, and the booking gate still refuses them.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("identity", identify(request, auth.user.id), LIMITS.connect);
    if (!limited.ok) return tooManyRequests(limited);

    const admin = supabaseAdmin();

    // Already done — nothing to open. Cheaper than a session Stripe would just
    // mark verified again, and it lets the client move straight on.
    const { data: profile } = await admin
      .from("profiles")
      .select("identity_verified_at, identity_session_id")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (profile?.identity_verified_at) {
      return Response.json({ alreadyVerified: true });
    }

    /*
     * Resume rather than respawn. Each new VerificationSession is a billable
     * check, so a practitioner tapping "verify" repeatedly must not mint a new
     * one each time. If the last session is still open we hand back its own
     * link; if Stripe is still reviewing it there is nothing to reopen; only a
     * genuinely spent session (cancelled, or none) starts a fresh one. The
     * rate limit above is the outer bound; this keeps the ordinary case cheap.
     */
    if (profile?.identity_session_id) {
      const existing = await retrieveIdentitySession(profile.identity_session_id).catch(() => null);
      if (existing?.status === "verified") return Response.json({ alreadyVerified: true });
      if (existing?.status === "processing") return Response.json({ checking: true });
      if (existing?.status === "requires_input" && existing.url) {
        return Response.json({ url: existing.url });
      }
      // canceled, or the session could not be read — fall through and start one.
    }

    const origin = request.nextUrl.origin;
    // The return lands on a marker the client polls against while the webhook
    // writes the verified time — see confirmIdentityVerification.
    const { id, url } = await createIdentitySession(auth.user.id, `${origin}/?identity=checking`);

    // The reference only. The documents stay with Stripe; the verified time is
    // the webhook's to write.
    await admin.from("profiles").update({ identity_session_id: id }).eq("id", auth.user.id);

    return Response.json({ url });
  });
}
