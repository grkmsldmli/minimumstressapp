import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, oneOf } from "@/lib/api/validate";
import { stripeGateway } from "@/lib/api/stripe-gateway";
import { answerRequest } from "@/lib/approval-service";
import { MAX_DECLINE_NOTE } from "@/lib/booking-approval";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * A host says yes or no to a request on their own room.
 *
 * The host is the signed-in user and is never read from the body, so a caller
 * cannot answer for somebody else's space however the payload is shaped —
 * `answerRequest` checks the space's owner against the session and returns 404
 * rather than 403 when they do not match, so probing ids tells you nothing.
 *
 * Rate-limited on the cancel allowance rather than a new one. It is the same
 * shape of action against the same table, and a host tapping approve twice
 * should hit a guard on the row, not a counter.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/bookings/[id]/approval">,
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("cancel", identify(request, auth.user.id), LIMITS.cancel);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    const parsed = await jsonObject(request);
    if (!parsed.ok) return jsonError(parsed.reason, 400);

    const decision = oneOf(parsed.value, "decision", ["approve", "decline"] as const);
    if (!decision.ok) return jsonError(decision.reason, 400);

    /*
     * Optional, and trimmed rather than required.
     *
     * A host declining should not have to justify it — it is their room — so
     * an empty note is a complete answer. When they do write one it reaches
     * the guest, which is why it is capped: this is a message to a person, not
     * a field to store an essay in.
     */
    const note =
      typeof parsed.value.note === "string"
        ? parsed.value.note.trim().slice(0, MAX_DECLINE_NOTE) || null
        : null;

    await answerRequest(
      supabaseAdmin(),
      stripeGateway,
      id,
      auth.user.id,
      decision.value,
      note,
    );

    return Response.json({ ok: true });
  });
}
