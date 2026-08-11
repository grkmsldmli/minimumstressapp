import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { integer, jsonObject, oneOf, optionalString, requiredString } from "@/lib/api/validate";
import { ClaimError, fileClaim } from "@/lib/claim-service";
import { CLAIM_TYPES } from "@/lib/claims";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * A studio reporting that a session left the room worse than it found it.
 *
 * Nothing here charges anybody. Filing a claim opens an argument and names a
 * figure; the practitioner answers it and a person decides. A route that could
 * take money on the host's say-so would be a route a host could point at
 * anyone, and the first practitioner it hit wrongly would never come back.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("refund", identify(request, auth.user.id), LIMITS.refund);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const parsed = await jsonObject(request);
    if (!parsed.ok) return jsonError(parsed.reason, 400);

    const kind = oneOf(
      parsed.value,
      "kind",
      CLAIM_TYPES.map((t) => t.kind) as [string, ...string[]],
    );
    if (!kind.ok) return jsonError(kind.reason, 400);

    const detail = requiredString(parsed.value, "detail", { min: 15, max: 2000 });
    if (!detail.ok) return jsonError(detail.reason, 400);

    const evidencePath = optionalString(parsed.value, "evidencePath", { max: 400 });
    if (!evidencePath.ok) return jsonError(evidencePath.reason, 400);

    /*
     * Both optional and both only meaningful for one kind. Read rather than
     * required, because `routeClaim` is what decides whether their absence
     * closes the claim — the rule lives in one place and this is not it.
     */
    const minutesOver = parsed.value.minutesOver === undefined
      ? { ok: true as const, value: null }
      : integer(parsed.value, "minutesOver", { min: 1, max: 600 });
    if (!minutesOver.ok) return jsonError(minutesOver.reason, 400);

    const claimedCents = parsed.value.claimedCents === undefined
      ? { ok: true as const, value: null }
      : integer(parsed.value, "claimedCents", { min: 1, max: 1_000_000 });
    if (!claimedCents.ok) return jsonError(claimedCents.reason, 400);

    try {
      const result = await fileClaim(supabaseAdmin(), id, auth.user.id, {
        kind: kind.value as (typeof CLAIM_TYPES)[number]["kind"],
        detail: detail.value,
        evidencePath: evidencePath.value || null,
        minutesOver: minutesOver.value,
        claimedCents: claimedCents.value,
      });

      return Response.json(result, { status: 201 });
    } catch (failure) {
      if (failure instanceof ClaimError) return jsonError(failure.message, failure.status);
      throw failure;
    }
  });
}
