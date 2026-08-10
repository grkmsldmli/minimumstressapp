import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, oneOf } from "@/lib/api/validate";
import { stripeGateway } from "@/lib/api/stripe-gateway";
import { cancelBooking } from "@/lib/booking-service";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Cancel a booking, and move whatever the policy says should move.
 *
 * `actor` says which side is cancelling, and the two are not interchangeable:
 * a practitioner inside 24 hours is charged in full, while a host cancelling at
 * any point owes a refund. So the claim is checked rather
 * than trusted — `cancelBooking` verifies the caller really is the
 * practitioner on the booking or the host of its space, and refuses otherwise.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/bookings/[id]/cancel">,
): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("cancel", identify(request, auth.user.id), LIMITS.cancel);
    if (!limited.ok) return tooManyRequests(limited);

    const { id } = await context.params;

    // An empty body is fine here — actor defaults below — so a parse failure
    // is treated as "nothing sent" rather than as an error.
    const parsed = await jsonObject(request);
    const body = parsed.ok ? parsed.value : {};

    const actor = oneOf(body, "actor", ["practitioner", "host"] as const, "practitioner");
    if (!actor.ok) return jsonError(actor.reason, 400);

    await cancelBooking(supabaseAdmin(), stripeGateway, id, actor.value, auth.user.id);

    return Response.json({ ok: true });
  });
}
