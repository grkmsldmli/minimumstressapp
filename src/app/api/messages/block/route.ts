import type { NextRequest } from "next/server";

import { bookingParties, counterpartFor } from "@/lib/api/message-safety";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Block the other party in a booking's message thread (App Store Guideline 1.2).
 *
 * The caller says only which booking; the server confirms they are a participant,
 * works out who the other party is, and records a block. The send guard (0067)
 * then closes the chat both ways. The booking, its records, and its access
 * details are untouched — a block never strands anyone at a locked door.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => null)) as { bookingId?: unknown } | null;
    const bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
    if (!bookingId) return jsonError("Missing bookingId", 400);

    const admin = supabaseAdmin();
    const parties = await bookingParties(admin, bookingId);
    if (!parties) return jsonError("That booking no longer exists", 404);

    const blockedId = counterpartFor(parties, auth.user.id);
    if (!blockedId) return jsonError("You are not part of that booking", 403);

    // Idempotent: a repeat block is the same primary key, and fine.
    const { error } = await admin
      .from("blocked_users")
      .upsert(
        { blocker_id: auth.user.id, blocked_id: blockedId },
        { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
      );
    if (error) throw new Error("could not record block");

    return Response.json({ ok: true });
  });
}
