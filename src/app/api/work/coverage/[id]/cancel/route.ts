import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cancelCoverage, explainWorkFailure } from "@/lib/work-service";

/** Cancel a coverage request. Only its host may, and only while it is open. */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/work/coverage/[id]/cancel">,
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const result = await cancelCoverage(supabaseAdmin(), auth.user.id, id);
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }

    return Response.json({ ok: true });
  });
}
