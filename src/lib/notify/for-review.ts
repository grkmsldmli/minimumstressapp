import type { SupabaseClient } from "@supabase/supabase-js";

import { REVIEW_WINDOW_DAYS } from "../reviews";
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
