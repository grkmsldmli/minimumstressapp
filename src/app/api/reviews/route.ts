import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { flag, integer, jsonObject, optionalString, uuid } from "@/lib/api/validate";
import { submitReview, type SubmitFailure } from "@/lib/review-service";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Submitting a review.
 *
 * The body says what the reviewer thought and nothing about who they are or
 * which side they are on. Both are derived from the booking server-side: a
 * caller who could name their own role could review as the other party, and
 * the one-per-side constraint would then consume the slot the real counterpart
 * needed. The author is the session user, never a field.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("review", identify(request, auth.user.id), LIMITS.review);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const bookingId = uuid(body.value, "bookingId");
    if (!bookingId.ok) return jsonError(bookingId.reason, 400);

    // Bounded here as well as in the service: the column is unbounded text and
    // this is the outermost point a person's typing reaches it.
    const overall = integer(body.value, "overall", { min: 1, max: 5 });
    if (!overall.ok) return jsonError(overall.reason, 400);

    const comment = optionalString(body.value, "comment", { max: 5000 });
    if (!comment.ok) return jsonError(comment.reason, 400);

    const result = await submitReview(supabaseAdmin(), auth.user.id, {
      bookingId: bookingId.value,
      overall: overall.value,
      comment: comment.value,
      safetyConcern: flag(body.value, "safetyConcern"),
      practitioner: asAnswers(body.value.practitioner),
      host: asAnswers(body.value.host),
    });

    if (!result.ok) {
      return jsonError(explain(result.reason), statusFor(result.reason));
    }

    /**
     * Whether it escalated is deliberately not reported back.
     *
     * Someone who learns that three stars triggers a review learns exactly how
     * to avoid triggering one, and the reports worth having are the ones
     * written by people who are not managing us. The reviewer is told their
     * review was received, which is true and is all they need.
     */
    return Response.json({ ok: true }, { status: 201 });
  });
}

/** Only the shape; every value is re-validated in the service. */
function asAnswers(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function explain(reason: SubmitFailure): string {
  switch (reason) {
    case "not_found":
      return "We couldn't find that booking.";
    case "not_your_booking":
      // Same wording as not_found on purpose: telling a stranger that a
      // booking exists but is not theirs confirms it exists.
      return "We couldn't find that booking.";
    case "session_not_finished":
      return "You can leave a review once the session has finished.";
    case "window_closed":
      return "The window to review this session has closed.";
    case "already_reviewed":
      return "You've already reviewed this session.";
    case "booking_cancelled":
      return "This session was cancelled, so there's nothing to review.";
    case "invalid_rating":
      return "Please choose a rating from 1 to 5.";
  }
}

function statusFor(reason: SubmitFailure): number {
  switch (reason) {
    case "not_found":
    case "not_your_booking":
      return 404;
    case "already_reviewed":
      return 409;
    default:
      return 400;
  }
}
