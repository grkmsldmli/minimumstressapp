import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { forgetCards, savedCardFor } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The card we keep, and stopping us keeping it.
 *
 * A card is saved at the first booking and can be charged off-session
 * afterwards, for cleaning, overstay or damage a studio reports. Until this
 * route existed a practitioner could not see which card that was, could not
 * see it was being kept at all past the one sentence at checkout, and had no
 * way to take it back. Keeping somebody's card on those terms is how a support
 * request becomes a chargeback.
 *
 * Only ever four digits and a brand leave here. The number never reaches this
 * server at any point in its life.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("card", identify(request, auth.user.id), LIMITS.card);
    if (!limited.ok) return tooManyRequests(limited);

    const customerId = await customerIdFor(auth.user.id);
    if (!customerId) return Response.json({ card: null });

    return Response.json({ card: await savedCardFor(customerId) });
  });
}

/**
 * Forgetting the card.
 *
 * Refused while a studio's claim is still open, and that is the only thing
 * standing in the way. A claim is a bill somebody has been told about and can
 * answer; letting the card be removed between the telling and the deciding
 * would make every claim optional, and the studio would carry the loss for a
 * room they let somebody use.
 *
 * Nothing else blocks it. A future booking is already paid for, so there is
 * nothing outstanding on it, and a session that has passed without a claim is
 * finished. Somebody who wants their card gone should not have to wait out
 * their own calendar.
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("card", identify(request, auth.user.id), LIMITS.card);
    if (!limited.ok) return tooManyRequests(limited);

    const admin = supabaseAdmin();

    const { count: openClaims, error: claimError } = await admin
      .from("studio_claims")
      .select("id, bookings!inner(practitioner_id)", { count: "exact", head: true })
      .in("state", ["awaiting_practitioner", "awaiting_staff"])
      .eq("bookings.practitioner_id", auth.user.id);
    if (claimError) throw claimError;

    if ((openClaims ?? 0) > 0) {
      return jsonError(
        "A studio has raised something about one of your sessions and it has not been decided yet. Once it is, you can remove the card.",
        409,
      );
    }

    const customerId = await customerIdFor(auth.user.id);
    // Nothing to remove is the outcome they asked for, not an error.
    const removed = customerId ? await forgetCards(customerId) : 0;

    return Response.json({ ok: true, removed });
  });
}

async function customerIdFor(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  return data?.stripe_customer_id ?? null;
}
