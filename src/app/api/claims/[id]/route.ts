import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, requiredString } from "@/lib/api/validate";
import { ClaimError, replyToClaim } from "@/lib/claim-service";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The practitioner's account of the same session.
 *
 * Answering does not close the claim, and cannot. Somebody with money at stake
 * in the outcome must not be the one who decides it — the same rule that stops
 * a host closing a refund request by replying to it, pointed the other way.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("refund", identify(request, auth.user.id), LIMITS.refund);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const parsed = await jsonObject(request);
    if (!parsed.ok) return jsonError(parsed.reason, 400);

    const reply = requiredString(parsed.value, "reply", { min: 15, max: 2000 });
    if (!reply.ok) return jsonError(reply.reason, 400);

    try {
      await replyToClaim(supabaseAdmin(), id, auth.user.id, reply.value);
      return Response.json({ ok: true });
    } catch (failure) {
      if (failure instanceof ClaimError) return jsonError(failure.message, failure.status);
      throw failure;
    }
  });
}
