import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, optionalString } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";
import { expressInterest, explainWorkFailure, listRequestInterest } from "@/lib/work-service";

/**
 * GET — the host reads who is interested in their request, as safe previews
 * (partial name, profession, trust booleans, a distance label; never a
 * document, contact detail, or exact location). Ownership is checked server-side.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/work/coverage/[id]/interest">,
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("workRead", identify(request, auth.user.id), LIMITS.workRead);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const result = await listRequestInterest(supabaseAdmin(), auth.user.id, id);
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }

    return Response.json(
      { interest: result.value },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

/**
 * POST — a practitioner says they can cover it. No practitioner id is accepted;
 * the server derives it and re-checks the match, so only a genuinely eligible,
 * available practitioner can express interest (and never on their own request).
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/work/coverage/[id]/interest">,
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const parsed = await jsonObject(request);
    const body = parsed.ok ? parsed.value : {};
    const message = optionalString(body, "message", { max: 1000 });
    if (!message.ok) return jsonError(message.reason, 400);

    const result = await expressInterest(
      supabaseAdmin(),
      auth.user.id,
      id,
      message.value || null,
    );
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }

    return Response.json({ ok: true }, { status: 201 });
  });
}
