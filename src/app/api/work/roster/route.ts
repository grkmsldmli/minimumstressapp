import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, optionalString, uuid } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";
import { addToRoster, explainWorkFailure, listRoster } from "@/lib/work-service";

/**
 * My Roster — a studio's trusted substitute network. Both directions are gated
 * on Studio Pro (canUseRoster), checked server-side. A roster entry is earned:
 * the host can only add a practitioner they have already confirmed for a class.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("workRead", identify(request, auth.user.id), LIMITS.workRead);
    if (!limited.ok) return tooManyRequests(limited);

    const result = await listRoster(supabaseAdmin(), auth.user.id);
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }
    return Response.json(
      { roster: result.value },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);
    const practitionerId = uuid(body.value, "practitionerId");
    if (!practitionerId.ok) return jsonError(practitionerId.reason, 400);
    const note = optionalString(body.value, "note", { max: 500 });
    if (!note.ok) return jsonError(note.reason, 400);

    const result = await addToRoster(
      supabaseAdmin(),
      auth.user.id,
      practitionerId.value,
      note.value || null,
    );
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }
    return Response.json({ id: result.value.id }, { status: 201 });
  });
}
