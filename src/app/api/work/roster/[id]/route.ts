import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { explainWorkFailure, removeFromRoster } from "@/lib/work-service";

/** Remove one practitioner from the host's roster. Scoped to the host's own row,
 *  so a double-tap is harmless and a wrong id changes nothing. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;
    const result = await removeFromRoster(supabaseAdmin(), auth.user.id, id);
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }
    return Response.json({ ok: true });
  });
}
