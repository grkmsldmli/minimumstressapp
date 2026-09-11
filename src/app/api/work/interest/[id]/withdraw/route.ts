import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { explainWorkFailure, withdrawInterest } from "@/lib/work-service";

/**
 * Withdraw an interest. Only its practitioner may. Withdrawing a confirmed
 * shift reopens the request so the studio can choose again and tells the host
 * their cover fell through.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/work/interest/[id]/withdraw">,
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const result = await withdrawInterest(supabaseAdmin(), auth.user.id, id);
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }

    return Response.json({ ok: true });
  });
}
