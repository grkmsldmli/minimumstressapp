import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { stripeGateway } from "@/lib/api/stripe-gateway";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { integer, jsonObject, oneOf, timestamp, uuid } from "@/lib/api/validate";
import { BOOKING_USES, MAX_OTHER_CHARS } from "@/lib/booking-use";
import {
  BookingError,
  createBooking,
  preflightSeries,
  rollbackSeries,
} from "@/lib/booking-service";
import { MAX_SERIES_OCCURRENCES, describeSeries, seriesOccurrences } from "@/lib/series";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The same hour, every week, booked in one request.
 *
 * Each occurrence goes through the same rules a single booking does — the same
 * eligibility, cover, availability, price and charge. Nothing here is a cheaper
 * path: a series that skipped the rules would be a way to book an hour a host
 * never opened, twelve times over.
 *
 * All-or-nothing, from the person's side. The whole run is preflighted before
 * anything is created or charged, and if any week cannot be booked — a taken
 * hour, cover that ends mid-series — none is. Booking the covered weeks and
 * charging for them while reporting the rest is the partial series this refuses:
 * somebody who asked for twelve weeks got some of them and a bill, and had to
 * reconcile which. So it is twelve or a clear reason, never a silent subset.
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

    if (!space) return jsonError("We couldn't find that space.", 404);

    const isPro = Boolean(practitioner?.is_pro);
    if (weeks.value > 1 && !isPro) {
      return jsonError("Recurring bookings are a Pro feature. Go Pro to book a weekly series.", 403);
    }

    const occurrences = seriesOccurrences({
      firstStart: startsAt.value,
      weeks: weeks.value,
      timeZone: space.timezone,
      isPro,
      now: new Date(),
    });

    if (occurrences.length === 0) {
      return jsonError("None of those dates are within your booking window.", 409);
    }

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

    /*
     * The same declaration on every week of the run. A series is one intention
     * repeated, and asking again per occurrence would let the twelfth week carry
     * a purpose nobody chose for it.
     */
    const declared = { purpose: purpose.value, purposeNote, attendees: attendees.value };

    /*
     * Preflight the whole run before creating or charging any of it.
     *
     * This is where all-or-nothing is decided: professional eligibility, cover
     * for every occurrence's interval, availability and allowed use, judged
     * against one read of the facts. If any week fails, the run is refused here
     * — nothing has been created and no card has been touched — naming the week
     * and the reason.
     */
    const preflight = await preflightSeries(
      admin,
      stripeGateway,
      auth.user.id,
      spaceId.value,
      occurrences,
      declared,
    );
    if (!preflight.ok) {
      const when = new Intl.DateTimeFormat("en-US", {
        timeZone: space.timezone,
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(preflight.startsAt);
      return jsonError(`${when}: ${preflight.message}`, preflight.status);
    }

    /*
     * Only now, with the whole run cleared, is anything created or charged.
     *
     * One at a time and not in parallel: each booking charges a card and counts
     * against the concurrent-session limit, both read per call — firing twelve
     * at once would let an account past a cap the server enforces and make
     * twelve charges out of one tap. If a later week cannot be committed after
     * all — an hour taken in the seconds since the preflight — the ones already
     * made are rolled back, so a half-booked run never survives.
     */
    const booked: { startsAt: string; bookingId: string }[] = [];
    try {
      for (const occurrence of occurrences) {
        const result = await createBooking(admin, stripeGateway, auth.user.id, {
          spaceId: spaceId.value,
          startsAt: occurrence,
          declared,
        });
        booked.push({ startsAt: occurrence.toISOString(), bookingId: result.bookingId });
      }
    } catch (failure) {
      await rollbackSeries(
        admin,
        stripeGateway,
        booked.map((b) => b.bookingId),
      );
      if (failure instanceof BookingError) return jsonError(failure.message, failure.status);
      throw failure;
    }

    return Response.json(
      {
        booked,
        // Always empty now — a series is whole or refused — but kept so an older
        // client reading it still finds the field it expects.
        skipped: [],
        summary: describeSeries({
          booked: booked.map((b) => ({ startsAt: new Date(b.startsAt), bookingId: b.bookingId })),
          skipped: [],
        }),
      },
      { status: 201 },
    );
  });
}
