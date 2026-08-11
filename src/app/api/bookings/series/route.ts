import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { stripeGateway } from "@/lib/api/stripe-gateway";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { integer, jsonObject, timestamp, uuid } from "@/lib/api/validate";
import { BookingError, createBooking } from "@/lib/booking-service";
import { MAX_SERIES_OCCURRENCES, describeSeries, seriesOccurrences } from "@/lib/series";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The same hour, every week, booked in one request.
 *
 * Each occurrence goes through `createBooking` exactly as a single booking
 * does — the same availability check, the same price, the same charge. Nothing
 * here is a cheaper path: a series that skipped the rules would be a way to
 * book an hour a host never opened, twelve times over.
 *
 * Partial success is the normal outcome and is reported as such. Somebody
 * booking four Tuesdays will find one taken, and the honest answer is three
 * bookings and a sentence about the fourth — not a refusal of the lot, and not
 * a silent three.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    // Priced like twelve bookings, because that is what it can be.
    const limited = check("series", identify(request, auth.user.id), LIMITS.series);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const spaceId = uuid(body.value, "spaceId");
    if (!spaceId.ok) return jsonError(spaceId.reason, 400);

    const startsAt = timestamp(body.value, "startsAt");
    if (!startsAt.ok) return jsonError(startsAt.reason, 400);

    const weeks = integer(body.value, "weeks", { min: 1, max: MAX_SERIES_OCCURRENCES });
    if (!weeks.ok) return jsonError(weeks.reason, 400);

    const admin = supabaseAdmin();

    /*
     * Pro and the room's zone, both read from stored rows.
     *
     * The zone decides what "the same hour every week" means across a daylight
     * saving change, and Pro decides how far the series may reach. Neither is
     * taken from the request: one is a fact about the room and the other is
     * something a caller would happily claim.
     */
    const [{ data: practitioner }, { data: space }] = await Promise.all([
      admin.from("profiles").select("is_pro").eq("id", auth.user.id).maybeSingle(),
      admin.from("spaces").select("timezone").eq("id", spaceId.value).maybeSingle(),
    ]);

    if (!space) return jsonError("No such space", 404);

    const isPro = Boolean(practitioner?.is_pro);
    if (weeks.value > 1 && !isPro) {
      return jsonError("Booking more than one week at a time is a Pro feature", 403);
    }

    const occurrences = seriesOccurrences({
      firstStart: startsAt.value,
      weeks: weeks.value,
      timeZone: space.timezone,
      isPro,
      now: new Date(),
    });

    if (occurrences.length === 0) {
      return jsonError("None of those weeks are inside your booking window", 409);
    }

    const booked: { startsAt: string; bookingId: string }[] = [];
    const skipped: { startsAt: string; because: string }[] = [];

    /*
     * One at a time, and deliberately not in parallel.
     *
     * Each booking charges a card and counts against the concurrent-session
     * limit, and the limit is read per call — firing twelve at once would let
     * a free account past a cap the server is supposed to enforce, and would
     * make twelve simultaneous charges out of one tap.
     */
    for (const occurrence of occurrences) {
      try {
        const result = await createBooking(admin, stripeGateway, auth.user.id, {
          spaceId: spaceId.value,
          startsAt: occurrence,
        });
        booked.push({ startsAt: occurrence.toISOString(), bookingId: result.bookingId });
      } catch (failure) {
        if (failure instanceof BookingError) {
          skipped.push({ startsAt: occurrence.toISOString(), because: failure.message });
          continue;
        }
        /*
         * Anything else stops the run rather than being counted as a skip. A
         * Stripe outage is not "that hour was taken", and continuing would
         * report eleven polite refusals for a fault on our side.
         */
        throw failure;
      }
    }

    return Response.json(
      {
        booked,
        skipped,
        summary: describeSeries({
          booked: booked.map((b) => ({ startsAt: new Date(b.startsAt), bookingId: b.bookingId })),
          skipped: skipped.map((s) => ({ startsAt: new Date(s.startsAt), because: s.because })),
        }),
      },
      { status: booked.length > 0 ? 201 : 409 },
    );
  });
}
