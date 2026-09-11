import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import {
  flag,
  integer,
  jsonObject,
  oneOf,
  optionalInteger,
  optionalString,
  requiredString,
  stringArray,
  timestamp,
  uuid,
} from "@/lib/api/validate";
import type { ProgrammingMode, SessionFormat } from "@/lib/domain";
import { isKnownProfession } from "@/lib/professions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { explainWorkFailure, postCoverage } from "@/lib/work-service";

const SESSION_FORMATS: readonly SessionFormat[] = ["group", "private", "semiprivate", "workshop"];
const PROGRAMMING_MODES: readonly ProgrammingMode[] = ["continue", "studio", "design"];

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

    // Structured listing fields (migration 0070). Every one is optional so a
    // minimal request still posts; the session format, when given, drives which
    // details a listing carries.
    const sessionFormat = body.value.sessionFormat == null
      ? null
      : oneOf<SessionFormat>(body.value, "sessionFormat", SESSION_FORMATS);
    if (sessionFormat && !sessionFormat.ok) return jsonError(sessionFormat.reason, 400);

    const programming = body.value.programming == null
      ? null
      : oneOf<ProgrammingMode>(body.value, "programming", PROGRAMMING_MODES);
    if (programming && !programming.ok) return jsonError(programming.reason, 400);

    const level = optionalString(body.value, "level", { max: 80 });
    if (!level.ok) return jsonError(level.reason, 400);

    const equipmentNotes = optionalString(body.value, "equipmentNotes", { max: 2000 });
    if (!equipmentNotes.ok) return jsonError(equipmentNotes.reason, 400);

    const audience = optionalString(body.value, "audience", { max: 500 });
    if (!audience.ok) return jsonError(audience.reason, 400);

    const teachingNotes = optionalString(body.value, "teachingNotes", { max: 2000 });
    if (!teachingNotes.ok) return jsonError(teachingNotes.reason, 400);

    const sessionGoal = optionalString(body.value, "sessionGoal", { max: 2000 });
    if (!sessionGoal.ok) return jsonError(sessionGoal.reason, 400);

    const clientExperience = optionalString(body.value, "clientExperience", { max: 2000 });
    if (!clientExperience.ok) return jsonError(clientExperience.reason, 400);

    const accommodations = optionalString(body.value, "accommodations", { max: 2000 });
    if (!accommodations.ok) return jsonError(accommodations.reason, 400);

    const participantsExpected = optionalInteger(body.value, "participantsExpected", { min: 0, max: 1000 });
    if (!participantsExpected.ok) return jsonError(participantsExpected.reason, 400);

    const participantsMax = optionalInteger(body.value, "participantsMax", { min: 0, max: 1000 });
    if (!participantsMax.ok) return jsonError(participantsMax.reason, 400);

    const requiredQualifications = stringArray(body.value, "requiredQualifications");
    if (!requiredQualifications.ok) return jsonError(requiredQualifications.reason, 400);

    const preferredQualifications = stringArray(body.value, "preferredQualifications");
    if (!preferredQualifications.ok) return jsonError(preferredQualifications.reason, 400);

    const result = await postCoverage(supabaseAdmin(), auth.user.id, {
      spaceId: spaceId.value,
      classTemplateId,
      title: title.value,
      profession,
      level: level.value || null,
      participantsMax: participantsMax.value,
      equipmentNotes: equipmentNotes.value || null,
      startsAt: startsAt.value,
      durationMinutes: durationMinutes.value,
      payCents: payCents.value,
      notes: notes.value || null,
      urgent: flag(body.value, "urgent"),
      sessionFormat: sessionFormat ? sessionFormat.value : null,
      participantsExpected: participantsExpected.value,
      audience: audience.value || null,
      teachingNotes: teachingNotes.value || null,
      requiredQualifications: requiredQualifications.value,
      preferredQualifications: preferredQualifications.value,
      sessionGoal: sessionGoal.value || null,
      clientExperience: clientExperience.value || null,
      accommodations: accommodations.value || null,
      programming: programming ? programming.value : null,
    });
    if (!result.ok) {
      const e = explainWorkFailure(result.reason);
      return jsonError(e.message, e.status);
    }

    return Response.json({ requestId: result.value.requestId }, { status: 201 });
  });
}
