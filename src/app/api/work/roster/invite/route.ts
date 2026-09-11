import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, uuid } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";
import { explainWorkFailure, inviteFromRoster } from "@/lib/work-service";

/**
 * Invite a roster member to a specific open request. This only notifies — it
 * never assigns. The practitioner still applies from the board and is confirmed
 * through the atomic single-fill, so a roster can never bypass it.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);
    const requestId = uuid(body.value, "requestId");
    if (!requestId.ok) return jsonError(requestId.reason, 400);
    const practitionerId = uuid(body.value, "practitionerId");
    if (!practitionerId.ok) return jsonError(practitionerId.reason, 400);

    const result = await inviteFromRoster(
      supabaseAdmin(),
      auth.user.id,
      requestId.value,
      practitionerId.value,
    );
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }
    return Response.json({ ok: true });
  });
}
