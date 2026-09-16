import { after, type NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, requiredString, uuid } from "@/lib/api/validate";
import {
  explainOffPlatformRequest,
  explainRedaction,
  isEmptyAfterRedaction,
  offPlatformRequest,
  redact,
} from "@/lib/message-redaction";
import { processMessageNotificationJobs } from "@/lib/notify/message-jobs";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Small participant-only thread state. Message bodies still come exclusively
 * from messages_visible; this only lets a composer reflect a block placed on
 * another device before the user attempts a doomed send.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("message-read", identify(request, auth.user.id), LIMITS.messageRead);
    if (!limited.ok) return tooManyRequests(limited);

    const parsed = uuid(
      { bookingId: request.nextUrl.searchParams.get("bookingId") },
      "bookingId",
    );
    if (!parsed.ok) return jsonError(parsed.reason, 400);

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("bookings")
      .select("practitioner_id, spaces(host_id)")
      .eq("id", parsed.value)
      .maybeSingle();
    if (error) throw error;

    const booking = data as unknown as {
      practitioner_id: string;
      spaces: { host_id: string } | null;
    } | null;
    const hostId = booking?.spaces?.host_id ?? null;
    if (!booking || (auth.user.id !== booking.practitioner_id && auth.user.id !== hostId)) {
      return jsonError("We couldn't find that booking.", 404);
    }

    const { data: block, error: blockError } = await admin
      .from("blocked_users")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${booking.practitioner_id},blocked_id.eq.${hostId}),and(blocker_id.eq.${hostId},blocked_id.eq.${booking.practitioner_id})`,
      )
      .limit(1)
      .maybeSingle();
    if (blockError) throw blockError;

    return Response.json({ blocked: Boolean(block) });
  });
}

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

    // A block is enforced in Postgres too, but checking it here keeps a normal
    // safety action from surfacing as an opaque 500 if somebody still has an
    // old composer open on another device. Either direction closes the thread.
    const { data: block, error: blockError } = await admin
      .from("blocked_users")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${row!.practitioner_id},blocked_id.eq.${hostId}),and(blocker_id.eq.${hostId},blocked_id.eq.${row!.practitioner_id})`,
      )
      .limit(1)
      .maybeSingle();
    if (blockError) throw blockError;
    if (block) return jsonError("Messaging isn't available for this booking.", 409);

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

    // Do not merely mask a request for the other person's contact details.
    // The request itself is the off-platform handoff; stopping it before a row
    // is written keeps the recipient from being pressured to disclose anything.
    const handoff = offPlatformRequest(text.value);
    if (handoff) return jsonError(explainOffPlatformRequest(handoff), 400);

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

    if (insertError) {
      // A block can race this request after the preflight above. The database
      // trigger is the final authority; translate its refusal into the same
      // plain state instead of leaking a constraint-shaped 500.
      if (insertError.code === "23514") {
        return jsonError("Messaging isn't available for this booking.", 409);
      }
      throw insertError;
    }

    /*
     * The insert trigger already created a durable job in the same transaction.
     * `after` is only the low-latency attempt; if the runtime dies at any point,
     * the frequent worker claims the same job later. The notification outbox is
     * independently deduplicated by message id, so even a crash between enqueue
     * and completion cannot produce a second semantic alert.
     */
    after(() =>
      processMessageNotificationJobs(admin, { limit: 1, messageId: inserted.id }).then(
        () => undefined,
      ),
    );

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
