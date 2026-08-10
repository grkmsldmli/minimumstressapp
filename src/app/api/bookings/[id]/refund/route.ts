import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, oneOf, optionalString, requiredString } from "@/lib/api/validate";
import { RefundError, requestRefund } from "@/lib/refund-service";
import { REFUND_QUESTIONS } from "@/lib/refunds";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Asking for money back on a booking.
 *
 * The reason is a value from a fixed list rather than a paragraph, and the
 * route refuses anything else — not to make the form tidy, but because a
 * reason that cannot be counted cannot be compared, and comparing is the only
 * way a pattern of requests becomes visible.
 *
 * Nothing here decides anything a person would need to weigh. `requestRefund`
 * routes it, and the only requests it settles on the spot are the ones where
 * no second account of events exists to hear — a change of mind, or a window
 * that has closed.
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

    const reason = oneOf(
      parsed.value,
      "reason",
      REFUND_QUESTIONS.map((q) => q.reason) as [string, ...string[]],
    );
    if (!reason.ok) return jsonError(reason.reason, 400);

    /*
     * Required, and long enough to be a sentence. A one-word reason plus a
     * one-word detail leaves a host answering an accusation they cannot see
     * the shape of, and staff deciding between two blanks.
     */
    const detail = requiredString(parsed.value, "detail", { min: 15, max: 2000 });
    if (!detail.ok) return jsonError(detail.reason, 400);

    const evidencePath = optionalString(parsed.value, "evidencePath", { max: 400 });
    if (!evidencePath.ok) return jsonError(evidencePath.reason, 400);

    try {
      const result = await requestRefund(supabaseAdmin(), id, auth.user.id, {
        reason: reason.value as (typeof REFUND_QUESTIONS)[number]["reason"],
        detail: detail.value,
        evidencePath: evidencePath.value ?? null,
      });

      return Response.json(result, { status: 201 });
    } catch (failure) {
      if (failure instanceof RefundError) {
        return jsonError(failure.message, failure.status);
      }
      throw failure;
    }
  });
}
