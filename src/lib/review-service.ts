import type { SupabaseClient } from "@supabase/supabase-js";

import { safetyRecipient } from "./admin/access";
import { notify } from "./notify/send";
import {
  type HostReview,
  type PractitionerReview,
  type Rating,
  canReview,
  escalationPriority,
  isRating,
  needsEscalation,
} from "./reviews";

/**
 * Writing a review, and getting the bad ones in front of a person.
 *
 * Runs server-side with the admin client, and that is the enforcement rather
 * than a convenience. Whether someone may review depends on the session having
 * ended, on them having been one of the two parties, and on there being no
 * earlier review from their side — three facts a client can be made to lie
 * about. So `reviews` has no insert policy at all: this is the only way a row
 * gets written.
 */

export type SubmitFailure =
  | "not_found"
  | "not_your_booking"
  | "session_not_finished"
  | "window_closed"
  | "already_reviewed"
  | "booking_cancelled"
  | "invalid_rating";

export type SubmitResult =
  | { ok: true; escalated: boolean }
  | { ok: false; reason: SubmitFailure };

export interface ReviewSubmission {
  bookingId: string;
  overall: number;
  comment: string;
  safetyConcern: boolean;
  /** Whichever set matches the author's side. The other is ignored. */
  practitioner?: Partial<Omit<PractitionerReview, "overall">>;
  host?: Partial<Omit<HostReview, "overall">>;
}

interface BookingRow {
  id: string;
  space_id: string;
  practitioner_id: string;
  ends_at: string;
  status: string;
  spaces: { host_id: string; name: string } | null;
}

export async function submitReview(
  admin: SupabaseClient,
  authorId: string,
  submission: ReviewSubmission,
  now: Date = new Date(),
): Promise<SubmitResult> {
  if (!isRating(submission.overall)) return { ok: false, reason: "invalid_rating" };

  const { data, error } = await admin
    .from("bookings")
    .select("id, space_id, practitioner_id, ends_at, status, spaces(host_id, name)")
    .eq("id", submission.bookingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "not_found" };

  const booking = data as unknown as BookingRow;
  const hostId = booking.spaces?.host_id ?? null;

  /**
   * Which side is writing is derived from the booking, never taken from the
   * request. A caller who could name their own role could review as the other
   * party — and the unique constraint on (booking_id, role) would then let
   * them use up the slot the real counterpart needed.
   */
  const role =
    authorId === booking.practitioner_id
      ? ("practitioner" as const)
      : authorId === hostId
        ? ("host" as const)
        : null;

  if (!role) return { ok: false, reason: "not_your_booking" };

  const subjectId = role === "practitioner" ? hostId! : booking.practitioner_id;

  const { count, error: countError } = await admin
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id)
    .eq("role", role);

  if (countError) throw countError;

  const eligibility = canReview(
    { endsAt: new Date(booking.ends_at), status: booking.status },
    (count ?? 0) > 0,
    now,
  );
  if (!eligibility.allowed) return { ok: false, reason: eligibility.reason };

  const overall = submission.overall as Rating;

  const { data: inserted, error: insertError } = await admin
    .from("reviews")
    .insert({
      booking_id: booking.id,
      author_id: authorId,
      subject_id: subjectId,
      role,
      overall,
      // Trimmed and capped. The column is unbounded text and this is the only
      // place a person's free typing reaches it.
      comment: submission.comment.trim().slice(0, 2000),
      safety_concern: submission.safetyConcern,
      ...(role === "practitioner"
        ? {
            access_on_time: submission.practitioner?.accessOnTime ?? null,
            cleanliness: ratingOrNull(submission.practitioner?.cleanliness),
            accuracy: ratingOrNull(submission.practitioner?.accuracy),
            would_book_again: submission.practitioner?.wouldBookAgain ?? null,
          }
        : {
            left_as_found: ratingOrNull(submission.host?.leftAsFound),
            respected_house_rules: submission.host?.respectedHouseRules ?? null,
            on_time: submission.host?.onTime ?? null,
            would_host_again: submission.host?.wouldHostAgain ?? null,
          }),
    })
    .select("id")
    .single();

  if (insertError) {
    // The unique constraint is the last line against two submissions racing
    // past the count above. Reported as what it is rather than as a crash.
    if (insertError.code === "23505") return { ok: false, reason: "already_reviewed" };
    throw insertError;
  }

  const escalate = needsEscalation({ overall, safetyConcern: submission.safetyConcern });

  if (escalate) {
    await raiseEscalation(admin, inserted.id, {
      overall,
      safetyConcern: submission.safetyConcern,
      comment: submission.comment,
      spaceName: booking.spaces?.name ?? "a space",
      role,
    });
  }

  return { ok: true, escalated: escalate };
}

function ratingOrNull(value: unknown): number | null {
  return isRating(value) ? value : null;
}

/**
 * Records the escalation and tells a human.
 *
 * The row is written first. An email that fails is recoverable — the queue
 * retries, and the row is still there to be found — whereas a notification
 * sent with no record behind it is a report that exists only in an inbox.
 */
async function raiseEscalation(
  admin: SupabaseClient,
  reviewId: string,
  context: {
    overall: Rating;
    safetyConcern: boolean;
    comment: string;
    spaceName: string;
    role: "practitioner" | "host";
  },
): Promise<void> {
  const priority = escalationPriority(context)!;

  const { error } = await admin.from("review_escalations").insert({
    review_id: reviewId,
    priority,
  });

  // A duplicate means it is already raised, which is fine. Anything else is
  // logged and swallowed: a failure here must not lose the review itself,
  // which is already written and is the thing that matters most.
  if (error && error.code !== "23505") {
    console.error(`Could not raise escalation for review ${reviewId}:`, error);
  }

  const staffEmail = safetyRecipient();
  if (!staffEmail) {
    console.error(
      `ESCALATION (${priority}) on review ${reviewId} — no SAFETY_ALERT_EMAIL and no ADMIN_EMAILS, so nobody was told.`,
    );
    return;
  }

  await notify({
    kind: "safety_escalation",
    // Staff, not a user — there is no profile row, and the outbox only needs
    // an address to send to and a key to deduplicate on.
    recipient: { userId: reviewId, email: staffEmail },
    subjectId: reviewId,
    context: {
      spaceName: context.spaceName,
      strikes: context.overall,
      reason: priority,
      // The words the person actually wrote. Summarising them here would
      // decide for staff which reports are worth reading.
      note: context.comment.slice(0, 1000),
      role: context.role,
    },
  });
}
