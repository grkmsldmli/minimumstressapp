import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { stripeGateway } from "@/lib/api/stripe-gateway";
import { createBooking } from "@/lib/booking-service";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Create a booking and authorise the card.
 *
 * The body carries a space and a start time. It does not carry a price, and
 * would be ignored if it did — everything about the money is recomputed
 * server-side from rows the caller cannot write. See `booking-plan.ts`.
 *
 * The practitioner is the signed-in user, taken from the session cookie, so a
 * caller cannot book as someone else however the payload is shaped.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    // Counted against the signed-in user, not their address: the id comes
    // from a verified token, so it cannot be swapped for someone else's
    // allowance, and it follows them across a changed network.
    const limited = check("booking", identify(request, auth.user.id), LIMITS.booking);
    if (!limited.ok) return tooManyRequests(limited);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body", 400);
    }

    const { spaceId, startsAt } = (body ?? {}) as { spaceId?: unknown; startsAt?: unknown };

    if (typeof spaceId !== "string" || spaceId === "") {
      return jsonError("spaceId is required", 400);
    }
    if (typeof startsAt !== "string") {
      return jsonError("startsAt is required, as an ISO timestamp", 400);
    }

    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) {
      return jsonError("startsAt is not a valid timestamp", 400);
    }

    // The admin client, because writing the booking, its ledger entry and the
    // PaymentIntent has to outrank the person asking — a practitioner has no
    // insert rights on `bookings` by design.
    const result = await createBooking(supabaseAdmin(), stripeGateway, auth.user.id, {
      spaceId,
      startsAt: start,
    });

    return Response.json(
      {
        bookingId: result.bookingId,
        // The sheet needs this to confirm the card. It is scoped to this one
        // intent and useless for anything else.
        clientSecret: result.clientSecret,
        // Echoed so the confirmation screen shows what was actually charged
        // rather than recomputing and risking a different answer.
        money: result.money,
      },
      { status: 201 },
    );
  });
}
