import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, uuid } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";
import { confirmInterest, explainWorkFailure } from "@/lib/work-service";

/**
 * Confirm one interested practitioner. The atomic part runs in the database
 * (confirm_work_interest): exactly one is confirmed, the rest declined, the
 * request flipped to filled — so a second confirm cannot double-fill. Ownership
 * is verified here before the call, on the admin path.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/work/coverage/[id]/confirm">,
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);
    const interestId = uuid(body.value, "interestId");
    if (!interestId.ok) return jsonError(interestId.reason, 400);

    const result = await confirmInterest(supabaseAdmin(), auth.user.id, id, interestId.value);
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }

    return Response.json({ ok: true });
  });
}
