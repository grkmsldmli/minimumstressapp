import type { NextRequest } from "next/server";

import { bookingParties, counterpartFor } from "@/lib/api/message-safety";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Report the other party in a booking's message thread (App Store Guideline 1.2).
 *
 * The caller says only which booking and why; the server confirms they are a
 * participant, works out who the other party is, and records a report for staff
 * review. Nothing about the room, its address, its door code, or any message
 * body is stored — only who reported whom, on which booking, and the reason.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => null)) as {
      bookingId?: unknown;
      reason?: unknown;
    } | null;
    const bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
    if (!bookingId) return jsonError("Missing bookingId", 400);
    if (!reason) return jsonError("Tell us what happened", 400);

    const admin = supabaseAdmin();
    const parties = await bookingParties(admin, bookingId);
    if (!parties) return jsonError("That booking no longer exists", 404);

    const reportedUserId = counterpartFor(parties, auth.user.id);
    if (!reportedUserId) return jsonError("You are not part of that booking", 403);

    const { error } = await admin.from("message_reports").insert({
      booking_id: bookingId,
      reporter_id: auth.user.id,
      reported_user_id: reportedUserId,
      reason,
    });
    if (error) throw new Error("could not record report");

    return Response.json({ ok: true });
  });
}
