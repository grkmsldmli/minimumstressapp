import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { looksLikeEmail } from "@/lib/result-email";
import { spaceTypeBySlug } from "@/lib/space-types";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Somebody telling us what they were looking for when nothing came back.
 *
 * The one thing a marketplace with no inventory can still collect, and the
 * only honest answer to an empty search: we cannot show them a room, so we
 * take the request and write when there is one. Kept, these are what turns
 * "somebody might rent your studio" into "eleven people looked for a treatment
 * room in San Mateo last month" — which is the sentence that recruits a host.
 *
 * No sign-in. Asking for an account before somebody can say what they wanted
 * would collect almost nothing, which would defeat the point. So it is an open
 * endpoint that writes to a table, and what follows is the care that requires.
 */

const MAX_PLACE = 80;

export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const byCaller = check("space-request", identify(request), LIMITS.spaceRequest);
    if (!byCaller.ok) return tooManyRequests(byCaller);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonError("Nothing to record", 400);

    const lookingIn = typeof body.lookingIn === "string" ? body.lookingIn.trim() : "";
    if (!lookingIn) return jsonError("Tell us which town you are looking in", 400);
    if (lookingIn.length > MAX_PLACE) return jsonError("That does not look like a town", 400);

    /*
     * The use is checked against our own list rather than stored as typed.
     * These become the labels on a demand page and the thing a host is told
     * about, and an unrecognised one would either be refused by the check
     * constraint — losing the request over a stale tab — or quietly split one
     * town's demand across two spellings.
     */
    const spaceType =
      typeof body.spaceType === "string" ? (spaceTypeBySlug(body.spaceType)?.slug ?? null) : null;

    /*
     * The address is optional and it is the only reason to be careful here.
     * A typo means we cannot write back, which is a request wasted rather than
     * a request refused — so a bad address drops the address and keeps the
     * request, instead of throwing the whole thing away.
     */
    const typed = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const email = typed && looksLikeEmail(typed) ? typed.slice(0, 200) : null;

    /*
     * The admin client, for a table that grants insert to anon.
     *
     * Not because the write needs elevating — it does not — but because this
     * runs on the server with no session, and going through the anon client
     * here would mean a second Supabase client configured for no reason. The
     * row it writes is exactly the row an anonymous caller is allowed to
     * write; nothing about the shape depends on the elevation.
     */
    const { error } = await supabaseAdmin()
      .from("space_requests")
      .insert({ space_type: spaceType, looking_in: lookingIn, email });

    if (error) {
      // The reason is ours. A constraint name is not something the reader can
      // act on, and it is not something to describe to them either.
      return jsonError("We could not record that just now. Try again in a moment.", 502);
    }

    return Response.json({ ok: true });
  });
}
