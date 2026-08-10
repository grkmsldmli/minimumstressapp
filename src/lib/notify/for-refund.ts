import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { questionFor, type RefundReason } from "../refunds";
import { formatWhen, hasOptedOut, recipientFor } from "./for-booking";
import { notify } from "./send";

/**
 * Telling the two sides of a refund request what is happening.
 *
 * Both messages exist for the same reason: a refund dispute that goes quiet is
 * a refund dispute that turns into a chargeback, which costs more than the
 * refund and takes the decision away from everyone. So the studio is asked
 * rather than left to find out, and the practitioner is answered rather than
 * left waiting.
 *
 * Failures are swallowed, as everywhere else in this folder. The request is
 * real whether or not an email goes out, and throwing here would roll back a
 * refund somebody is owed because a mail provider was briefly down.
 */

interface RequestRow {
  id: string;
  reason: RefundReason;
  detail: string;
  practitioner_id: string;
  bookings: {
    id: string;
    starts_at: string;
    spaces: { name: string; host_id: string; timezone: string };
  };
}

async function loadRequest(
  admin: SupabaseClient,
  requestId: string,
): Promise<RequestRow | null> {
  const { data } = await admin
    .from("refund_requests")
    .select(
      "id, reason, detail, practitioner_id, bookings!inner(id, starts_at, spaces!inner(name, host_id, timezone))",
    )
    .eq("id", requestId)
    .maybeSingle();

  return (data as RequestRow | null) ?? null;
}

/**
 * Goes to the studio, and only when the studio is the one being asked.
 *
 * A request routed straight to staff — anything unsafe, or a pattern worth a
 * person — does not reach the host at all. Telling somebody they have been
 * accused and then not letting them answer is worse than not telling them.
 */
export async function notifyRefundRequested(
  admin: SupabaseClient,
  requestId: string,
): Promise<void> {
  try {
    const request = await loadRequest(admin, requestId);
    if (!request) return;

    const { data: state } = await admin
      .from("refund_requests")
      .select("state")
      .eq("id", requestId)
      .maybeSingle();

    if (state?.state !== "awaiting_host") return;

    const host = await recipientFor(admin, request.bookings.spaces.host_id);
    if (!host || hasOptedOut(host, "refund_requested")) return;

    await notify({
      kind: "refund_requested",
      recipient: host,
      subjectId: requestId,
      bookingId: request.bookings.id,
      context: {
        spaceName: request.bookings.spaces.name,
        when: formatWhen(new Date(request.bookings.starts_at), request.bookings.spaces.timezone),
        // The label they chose, not the enum key. "no_access" means nothing to
        // somebody reading it over breakfast.
        reason: questionFor(request.reason).label.toLowerCase(),
        note: request.detail,
      },
    });
  } catch (error) {
    console.error(`Refund request notification failed for ${requestId}:`, error);
  }
}

/** Goes to whoever asked, with the reasoning attached. */
export async function notifyRefundDecided(
  admin: SupabaseClient,
  requestId: string,
): Promise<void> {
  try {
    const request = await loadRequest(admin, requestId);
    if (!request) return;

    const { data: decision } = await admin
      .from("refund_requests")
      .select("refunded_cents, decision_note")
      .eq("id", requestId)
      .maybeSingle();

    const practitioner = await recipientFor(admin, request.practitioner_id);
    if (!practitioner) return;

    await notify({
      kind: "refund_decided",
      recipient: practitioner,
      subjectId: requestId,
      bookingId: request.bookings.id,
      context: {
        spaceName: request.bookings.spaces.name,
        refundedCents: decision?.refunded_cents ?? 0,
        note: decision?.decision_note ?? undefined,
      },
    });
  } catch (error) {
    console.error(`Refund decision notification failed for ${requestId}:`, error);
  }
}
