import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { integer, jsonObject, oneOf, timestamp, uuid } from "@/lib/api/validate";
import { BOOKING_USES, MAX_OTHER_CHARS } from "@/lib/booking-use";
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

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const spaceId = uuid(body.value, "spaceId");
    if (!spaceId.ok) return jsonError(spaceId.reason, 400);

    const startsAt = timestamp(body.value, "startsAt");
    if (!startsAt.ok) return jsonError(startsAt.reason, 400);

    /*
     * What the space will be used for. Read here rather than defaulted:
     * planBooking refuses a booking with no declaration, and a route that
     * quietly supplied one would be making the statement on somebody's behalf.
     */
    const purpose = oneOf(
      body.value,
      "purpose",
      BOOKING_USES.map((use) => use.key),
    );
    if (!purpose.ok) return jsonError(purpose.reason, 400);

    const attendees = integer(body.value, "attendees", { min: 1, max: 200 });
    if (!attendees.ok) return jsonError(attendees.reason, 400);

    const purposeNote =
      typeof body.value.purposeNote === "string"
        ? body.value.purposeNote.trim().slice(0, MAX_OTHER_CHARS)
        : null;

    // The admin client, because writing the booking, its ledger entry and the
    // PaymentIntent has to outrank the person asking — a practitioner has no
    // insert rights on `bookings` by design.
    const result = await createBooking(supabaseAdmin(), stripeGateway, auth.user.id, {
      spaceId: spaceId.value,
      startsAt: startsAt.value,
      declared: { purpose: purpose.value, purposeNote, attendees: attendees.value },
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
