import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, requiredString } from "@/lib/api/validate";
import { RefundError, replyToRefund } from "@/lib/refund-service";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The studio's account of the same session.
 *
 * Answering does not close the request and cannot. The host has money at stake
 * in the outcome, so letting their reply settle it would hand the decision to
 * one of the two people arguing — their words are evidence, and a person still
 * reads both sides.
 *
 * They are also not obliged to answer. After two days it moves to staff on
 * whatever is there, because a host who says nothing must not be able to stall
 * a refund somebody is owed.
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
      await replyToRefund(supabaseAdmin(), id, auth.user.id, reply.value);
      return Response.json({ ok: true });
    } catch (failure) {
      if (failure instanceof RefundError) {
        return jsonError(failure.message, failure.status);
      }
      throw failure;
    }
  });
}
