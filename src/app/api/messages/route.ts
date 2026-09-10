import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, requiredString, uuid } from "@/lib/api/validate";
import { explainRedaction, isEmptyAfterRedaction, redact } from "@/lib/message-redaction";
import { notifyNewMessage } from "@/lib/notify/for-booking";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Sending a message on a booking.
 *
 * Written through here rather than directly, for one reason: the masking has
 * to happen somewhere a client cannot skip. Reading is a policy — either you
 * are on the booking or you are not — but a client that could insert its own
 * row could insert an unmasked one, and the whole point is that a phone number
 * never reaches the other side.
 *
 * Both texts are stored. The recipient gets the masked one; the original is
 * kept out of the view they read and exists for the case where somebody
 * reports what was said to them.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("message", identify(request, auth.user.id), LIMITS.message);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const bookingId = uuid(body.value, "bookingId");
    if (!bookingId.ok) return jsonError(bookingId.reason, 400);

    const text = requiredString(body.value, "body", { max: 2000 });
    if (!text.ok) return jsonError(text.reason, 400);

    const admin = supabaseAdmin();

    /**
     * Participation is checked here as well as by the policy.
     *
     * This route writes with the service role, which bypasses RLS entirely —
     * so the policy that protects reading protects nothing on the way in. The
     * check has to be explicit, and it is the only thing standing between a
     * stranger and somebody else's thread.
     */
    const { data: booking, error } = await admin
      .from("bookings")
      .select("id, practitioner_id, status, captured_at, spaces(host_id)")
      .eq("id", bookingId.value)
      .maybeSingle();

    if (error) throw error;

    const row = booking as unknown as {
      practitioner_id: string;
      status: string;
      captured_at: string | null;
      spaces: { host_id: string } | null;
    } | null;

    const hostId = row?.spaces?.host_id ?? null;
    const isParticipant =
      row !== null && (auth.user.id === row.practitioner_id || auth.user.id === hostId);

    // Same message either way: telling a stranger that a booking exists but is
    // not theirs confirms it exists.
    if (!isParticipant) return jsonError("We couldn't find that booking.", 404);

    /**
     * Messaging is for a live booking. The database refuses a message on a
     * booking that is not captured or is cancelled (migration 0063); this checks
     * the same rule first, to answer with a plain sentence instead of a 500. No
     * payment terminology reaches the user.
     */
    const cancelled =
      row!.status === "cancelled_by_practitioner" || row!.status === "cancelled_by_host";
    if (row!.captured_at === null || cancelled) {
      return jsonError(
        cancelled
          ? "This booking is closed, so it can no longer receive messages."
          : "Messaging is available after your booking is confirmed.",
        409,
      );
    }

    const redaction = redact(text.value);

    if (isEmptyAfterRedaction(redaction)) {
      return jsonError(
        "That message was only contact details, so there'd be nothing left to send. Everything about this booking works here — the address, the door code, and the refund if it goes wrong.",
        400,
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from("messages")
      .insert({
        booking_id: bookingId.value,
        sender_id: auth.user.id,
        body: redaction.text,
        // Null when nothing was masked, so the ordinary case stores one copy.
        original_body: redaction.found.length > 0 ? text.value : null,
        redacted_kinds: redaction.found,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    /*
     * Tell the other side, best-effort. Deduped by the message id, so a retry
     * never notifies twice; the notification names only the booking, never the
     * text, address, or code. A failure here must not fail the send — the
     * message is already stored and visible in the thread.
     */
    void notifyNewMessage(admin, bookingId.value, auth.user.id, inserted.id);

    return Response.json(
      {
        ok: true,
        body: redaction.text,
        // Told to the sender, not the recipient. Somebody who has just had a
        // number hidden should learn why immediately, from their own screen.
        notice: explainRedaction(redaction.found),
      },
      { status: 201 },
    );
  });
}
