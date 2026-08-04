import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { stripeGateway } from "@/lib/api/stripe-gateway";
import { cancelBooking } from "@/lib/booking-service";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Cancel a booking, and move whatever the policy says should move.
 *
 * `actor` says which side is cancelling, and the two are not interchangeable:
 * a practitioner inside 24 hours is charged in full, while a host cancelling at
 * any point owes a refund and goodwill credit. So the claim is checked rather
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

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // An empty body is fine; actor defaults below.
    }

    const actor = (body as { actor?: unknown }).actor ?? "practitioner";
    if (actor !== "practitioner" && actor !== "host") {
      return jsonError("actor must be 'practitioner' or 'host'", 400);
    }

    await cancelBooking(supabaseAdmin(), stripeGateway, id, actor, auth.user.id);

    return Response.json({ ok: true });
  });
}
