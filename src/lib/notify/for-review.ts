import type { SupabaseClient } from "@supabase/supabase-js";

import { BLIND_PERIOD_DAYS, REVIEW_WINDOW_DAYS } from "../reviews";
import { formatWhen, recipientFor } from "./for-booking";
import { notify } from "./send";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ReviewNudgePhase = "prompt" | "reminder" | null;

/**
 * Two useful touches, not a drip campaign.
 *
 * The first lands after the session has had time to actually finish and the
 * second several days later while the experience is still fresh. After ten
 * days we stop nudging even though the review window itself remains open for
 * thirty. Silence is a valid answer.
 */
export function reviewNudgePhase(endsAt: Date, now: Date): ReviewNudgePhase {
  const age = now.getTime() - endsAt.getTime();
  if (age < 2 * HOUR_MS || age > REVIEW_WINDOW_DAYS * DAY_MS) return null;
  if (age < 72 * HOUR_MS) return "prompt";
  if (age < 10 * DAY_MS) return "reminder";
  return null;
}

interface ReviewBookingRow {
  id: string;
  practitioner_id: string;
  starts_at: string;
  ends_at: string;
  spaces: {
    name: string;
    host_id: string;
    timezone: string;
  };
}

/**
 * Prompt each side for a review after a real completed, paid session.
 *
 * Review eligibility still lives in submitReview/canReview; this is only a
 * reminder layer. We read existing reviews in one batch and never send a nudge
 * to a side that already answered. Dedupe keys make the scan safe to run on
 * every operational cron.
 */
export async function notifyReviewRequests(
  admin: SupabaseClient,
  now = new Date(),
): Promise<{ prompted: number; reminded: number }> {
  const earliest = new Date(now.getTime() - REVIEW_WINDOW_DAYS * DAY_MS).toISOString();
  const readyBy = new Date(now.getTime() - 2 * HOUR_MS).toISOString();

  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, starts_at, ends_at, spaces!inner(name, host_id, timezone)",
    )
    .eq("status", "completed")
    .not("captured_at", "is", null)
    .gte("ends_at", earliest)
    .lte("ends_at", readyBy)
    .order("ends_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  const bookings = (data ?? []) as unknown as ReviewBookingRow[];
  if (bookings.length === 0) return { prompted: 0, reminded: 0 };

  const ids = bookings.map((booking) => booking.id);
  const { data: reviews, error: reviewsError } = await admin
    .from("reviews")
    .select("booking_id, role")
    .in("booking_id", ids);
  if (reviewsError) throw reviewsError;

  const reviewed = new Set(
    (reviews ?? []).map((row) => `${row.booking_id as string}:${row.role as string}`),
  );

  let prompted = 0;
  let reminded = 0;

  for (const booking of bookings) {
    const endsAt = new Date(booking.ends_at);
    const phase = reviewNudgePhase(endsAt, now);
    if (!phase) continue;

    const when = formatWhen(new Date(booking.starts_at), booking.spaces.timezone);
    const expiresAt = new Date(endsAt.getTime() + REVIEW_WINDOW_DAYS * DAY_MS).toISOString();

    for (const side of [
      { role: "practitioner" as const, userId: booking.practitioner_id },
      { role: "host" as const, userId: booking.spaces.host_id },
    ]) {
      if (reviewed.has(`${booking.id}:${side.role}`)) continue;

      const recipient = await recipientFor(admin, side.userId);
      if (!recipient) continue;

      const outcome = await notify({
        kind: phase === "prompt" ? "review_prompt" : "review_reminder",
        recipient,
        subjectId: `${booking.id}:${side.role}:${phase}`,
        bookingId: booking.id,
        expiresAt,
        context: {
          spaceName: booking.spaces.name,
          when,
          role: side.role,
        },
      });

      if (Object.values(outcome).some((value) => value === "sent" || value === "queued")) {
        if (phase === "prompt") prompted += 1;
        else reminded += 1;
      }
    }
  }

  return { prompted, reminded };
}

interface ReviewLifecycleRow {
  id: string;
  booking_id: string;
  author_id: string;
  role: "practitioner" | "host";
  created_at: string;
}

export interface ReviewLifecycleAction {
  kind: "review_submitted" | "counterpart_reviewed" | "review_published";
  recipientId: string;
  subjectId: string;
}

/**
 * The lifecycle implied by durable review rows.
 *
 * This is deliberately reconstructable: the API calls it for speed, and cron
 * calls it for recovery. Dedupe keys make both routes converge on one email and
 * one push per semantic event.
 */
export function reviewLifecycleActions(
  reviews: ReviewLifecycleRow[],
  now: Date,
): ReviewLifecycleAction[] {
  const ordered = [...reviews].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.id.localeCompare(b.id),
  );
  const actions: ReviewLifecycleAction[] = ordered.map((review) => ({
    kind: "review_submitted",
    recipientId: review.author_id,
    subjectId: `${review.id}:author`,
  }));

  if (ordered.length >= 2) {
    const first = ordered[0];
    actions.push({
      kind: "counterpart_reviewed",
      recipientId: first.author_id,
      subjectId: `${first.booking_id}:${first.role}`,
    });
  } else if (ordered.length === 1) {
    const first = ordered[0];
    const releasesAt =
      new Date(first.created_at).getTime() + BLIND_PERIOD_DAYS * DAY_MS;
    if (now.getTime() >= releasesAt) {
      actions.push({
        kind: "review_published",
        recipientId: first.author_id,
        subjectId: first.id,
      });
    }
  }

  return actions;
}

/** Recoverable review receipts and blind-release notifications. */
export async function reconcileReviewLifecycleNotifications(
  admin: SupabaseClient,
  now = new Date(),
  bookingId?: string,
): Promise<{ submitted: number; counterpart: number; published: number }> {
  const earliest = new Date(now.getTime() - (REVIEW_WINDOW_DAYS + 1) * DAY_MS).toISOString();
  let query = admin
    .from("reviews")
    .select("id, booking_id, author_id, role, created_at")
    .gte("created_at", earliest)
    .order("created_at", { ascending: true });
  if (bookingId) query = query.eq("booking_id", bookingId);

  const { data, error } = await query.limit(400);
  if (error) throw error;
  const reviews = (data ?? []) as ReviewLifecycleRow[];
  if (reviews.length === 0) return { submitted: 0, counterpart: 0, published: 0 };

  const ids = [...new Set(reviews.map((review) => review.booking_id))];
  const { data: bookingRows, error: bookingError } = await admin
    .from("bookings")
    .select("id, starts_at, spaces!inner(name, timezone)")
    .in("id", ids);
  if (bookingError) throw bookingError;
  const bookingById = new Map(
    ((bookingRows ?? []) as unknown as Array<{
      id: string;
      starts_at: string;
      spaces: { name: string; timezone: string };
    }>).map((booking) => [booking.id, booking]),
  );

  const grouped = new Map<string, ReviewLifecycleRow[]>();
  for (const review of reviews) {
    const group = grouped.get(review.booking_id) ?? [];
    group.push(review);
    grouped.set(review.booking_id, group);
  }

  const result = { submitted: 0, counterpart: 0, published: 0 };
  let failed = false;
  for (const [id, group] of grouped) {
    const booking = bookingById.get(id);
    if (!booking) continue;
    const context = {
      spaceName: booking.spaces.name,
      when: formatWhen(new Date(booking.starts_at), booking.spaces.timezone),
    };

    for (const action of reviewLifecycleActions(group, now)) {
      try {
        const recipient = await recipientFor(admin, action.recipientId);
        if (!recipient) continue;
        const outcome = await notify({
          kind: action.kind,
          recipient,
          subjectId: action.subjectId,
          bookingId: id,
          context,
        });
        if (!Object.values(outcome).some((value) => value === "sent" || value === "queued")) {
          continue;
        }
        if (action.kind === "review_submitted") result.submitted += 1;
        else if (action.kind === "counterpart_reviewed") result.counterpart += 1;
        else result.published += 1;
      } catch (error) {
        failed = true;
        console.error(`Review lifecycle notification failed for ${id}:`, error);
      }
    }
  }

  if (failed) throw new Error("One or more review lifecycle notifications could not be queued");
  return result;
}
