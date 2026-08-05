import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, requiredString } from "@/lib/api/validate";
import { deleteAccount } from "@/lib/account-deletion";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Deleting your own account.
 *
 * The id comes from the session and nowhere else — there is no path here that
 * takes a user id from a caller, because an endpoint that deletes whoever it
 * is told to is one forged request away from deleting everybody.
 *
 * A typed confirmation is required. This is irreversible in a way almost
 * nothing else in the app is, and a POST with an empty body is something a
 * mis-scoped fetch can do by accident.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("account-delete", identify(request, auth.user.id), LIMITS.accountDelete);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const confirm = requiredString(body.value, "confirm", { max: 20 });
    if (!confirm.ok || confirm.value.toUpperCase() !== "DELETE") {
      return jsonError('Type DELETE to confirm', 400);
    }

    const result = await deleteAccount(supabaseAdmin(), auth.user.id);

    if (!result.ok) {
      if (result.reason === "upcoming_bookings") {
        return jsonError(
          `You have ${result.upcoming} session${result.upcoming === 1 ? "" : "s"} still to come. Cancel ${result.upcoming === 1 ? "it" : "them"} first — deleting now would leave the other side with a booking and nobody to ask.`,
          409,
        );
      }
      return jsonError("We couldn't find that account.", 404);
    }

    /**
     * What was removed, reported back. Somebody asking to be deleted is owed
     * more than "ok" — this is the only moment they can check that the thing
     * they cared about actually went.
     */
    return Response.json({
      ok: true,
      documentsRemoved: result.removed.documents,
      reviewsAnonymised: result.removed.reviews,
      bookingsKept: result.removed.bookings,
      note: "Completed bookings are kept as financial records for both sides, with your details removed.",
    });
  });
}
