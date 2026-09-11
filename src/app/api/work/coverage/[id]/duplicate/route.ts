import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, timestamp } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";
import { duplicateCoverage, explainWorkFailure } from "@/lib/work-service";

/**
 * Duplicate / repost a request into a fresh open one at a new time. The whole
 * session context is copied from the source; it goes through postCoverage, so
 * ownership, entitlement and the future-time check all hold, and no applicants
 * carry over — a repost is a new request nobody has applied to yet.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);
    const startsAt = timestamp(body.value, "startsAt");
    if (!startsAt.ok) return jsonError(startsAt.reason, 400);

    const result = await duplicateCoverage(supabaseAdmin(), auth.user.id, id, startsAt.value);
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }
    return Response.json({ requestId: result.value.requestId }, { status: 201 });
  });
}
