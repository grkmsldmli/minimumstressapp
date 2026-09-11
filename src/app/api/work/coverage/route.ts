import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { flag, integer, jsonObject, optionalString, requiredString, timestamp, uuid } from "@/lib/api/validate";
import { isKnownProfession } from "@/lib/professions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { explainWorkFailure, postCoverage } from "@/lib/work-service";

/**
 * Post a "need coverage" request.
 *
 * Server-side because it fans out: on the admin key it verifies the host owns
 * the space and template, freezes the title/profession/zone onto the row, then
 * matches and alerts eligible, opted-in practitioners. The client never writes
 * work_requests directly (no insert policy), so this is the only way one is made.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("work", identify(request, auth.user.id), LIMITS.work);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const spaceId = uuid(body.value, "spaceId");
    if (!spaceId.ok) return jsonError(spaceId.reason, 400);

    const title = requiredString(body.value, "title", { min: 2, max: 120 });
    if (!title.ok) return jsonError(title.reason, 400);

    const startsAt = timestamp(body.value, "startsAt");
    if (!startsAt.ok) return jsonError(startsAt.reason, 400);

    const durationMinutes = integer(body.value, "durationMinutes", { min: 15, max: 480 });
    if (!durationMinutes.ok) return jsonError(durationMinutes.reason, 400);

    const payCents = integer(body.value, "payCents", { min: 0, max: 1_000_000 });
    if (!payCents.ok) return jsonError(payCents.reason, 400);

    const notes = optionalString(body.value, "notes", { max: 2000 });
    if (!notes.ok) return jsonError(notes.reason, 400);

    const professionRaw = optionalString(body.value, "profession", { max: 40 });
    if (!professionRaw.ok) return jsonError(professionRaw.reason, 400);
    const profession =
      professionRaw.value && isKnownProfession(professionRaw.value) ? professionRaw.value : null;

    let classTemplateId: string | null = null;
    if (body.value.classTemplateId != null) {
      const t = uuid(body.value, "classTemplateId");
      if (!t.ok) return jsonError(t.reason, 400);
      classTemplateId = t.value;
    }

    const result = await postCoverage(supabaseAdmin(), auth.user.id, {
      spaceId: spaceId.value,
      classTemplateId,
      title: title.value,
      profession,
      startsAt: startsAt.value,
      durationMinutes: durationMinutes.value,
      payCents: payCents.value,
      notes: notes.value || null,
      urgent: flag(body.value, "urgent"),
    });
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }

    return Response.json({ requestId: result.value.requestId }, { status: 201 });
  });
}
