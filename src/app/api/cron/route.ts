import type { NextRequest } from "next/server";

import { abandonedBefore } from "@/lib/abandoned";
import { notifyAccessCodesReady, rebuildPending } from "@/lib/notify/for-booking";
import { retryPending } from "@/lib/notify/send";
import { payHost, settle } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Capturing payment when a session starts — the one thing that has to happen
 * on a clock rather than on a click.
 *
 * Revealing access codes deliberately is *not* here. A booking stores its own
 * `access_code_revealed_at` (start minus thirty minutes) and
 * `bookings_with_access_code` returns the code only once that moment has
 * passed, so the reveal happens on time whether or not anything is running.
 * A job would be strictly worse: it could be late, and the code would then be
 * late with it. What will need a job is *notifying* someone their code is
 * ready, which arrives with email.
 *
 * That distinction was worth catching — a first version of this file did run a
 * reveal job, and a live test appeared to prove it worked. It had not: the code
 * was already visible before the job ran, and the job reported zero rows
 * touched.
 *
 * Capture is driven by comparing database state to the current time, not by a
 * timer set when the booking was made. That is the difference between a job
 * that self-heals and one that silently drops work: if this does not run for
 * two hours, the next run catches everything it missed, because the query asks
 * "what is due and unhandled" rather than "what became due since I last ran".
 */

export async function GET(request: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("CRON_SECRET is not set; refusing to run");
    return new Response("Not configured", { status: 500 });
  }

  // Vercel Cron sends the secret as a bearer token. Without this the endpoint
  // is a public button for capturing everyone's payments early.
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();

  try {
    /**
     * Sequential, and the payouts go first.
     *
     * If the run is cut short — a function timeout, a deploy mid-run — the
     * thing that must already have happened is paying the hosts whose rooms
     * were used. A door-code email is recoverable on the next pass; a payout
     * that never happens is somebody who let a stranger into their studio and
     * was not paid for it.
     */
    const paid = await payHostsForFinishedSessions(now);
    const released = await releaseAbandonedCheckouts(now);
    const announced = await announceAccessCodes(now);
    const retried = await retryFailedNotifications();

    return Response.json({
      ranAt: now.toISOString(),
      ...paid,
      ...released,
      ...announced,
      ...retried,
    });
  } catch (error) {
    // Supabase rejects with a plain object rather than an Error, so the default
    // logging renders it as `{}` — useless at 3am when a payout run has
    // stopped. Pull the fields out by hand.
    console.error("Cron run failed:", describe(error));
    return Response.json({ error: describe(error) }, { status: 500 });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: string; details?: string; hint?: string; code?: string };
    return [e.code, e.message, e.details, e.hint].filter(Boolean).join(" — ") || JSON.stringify(error);
  }
  return String(error);
}

/**
 * Give back hours that were taken and never paid for.
 *
 * The booking row is written before the card is charged, on purpose — a charge
 * with no row is worse than a row with no charge. `booking-service` says as
 * much and calls the leftover "visible, unpaid, and safe to reap". Nothing
 * reaped it, so a closed tab at the card form blocked a studio's hour
 * permanently, ate one of a free account's three concurrent sessions, and
 * counted toward "booked this month" as money nobody paid.
 *
 * Cancelling the Stripe intent is what actually closes the booking: the
 * `payment_intent.canceled` webhook already moves the row to cancelled, and
 * routing through it means a hand-cancelled intent in the Stripe dashboard
 * ends the same way. The row is updated here too, because a webhook that is
 * slow or misconfigured must not leave the hour blocked.
 *
 * Failures are counted rather than thrown, for the same reason as payouts: one
 * stale intent must not stop the rest from being released.
 */
async function releaseAbandonedCheckouts(
  now: Date,
): Promise<{ released: number; releaseFailed: number }> {
  const admin = supabaseAdmin();

  const { data: stale, error } = await admin
    .from("bookings")
    .select("id, stripe_payment_intent_id")
    .eq("status", "upcoming")
    // Never paid. This is the whole safety condition — `captured_at` is
    // written by the `payment_intent.succeeded` webhook and by nothing else.
    .is("captured_at", null)
    .lt("created_at", abandonedBefore(now).toISOString());

  if (error) throw error;
  if (!stale?.length) return { released: 0, releaseFailed: 0 };

  let released = 0;
  let releaseFailed = 0;

  for (const booking of stale) {
    try {
      if (booking.stripe_payment_intent_id) {
        await settle(booking.stripe_payment_intent_id, { kind: "abandon" });
      }

      const { error: updateError } = await admin
        .from("bookings")
        .update({
          status: "cancelled_by_practitioner",
          cancelled_at: now.toISOString(),
          cancelled_by: "practitioner",
        })
        .eq("id", booking.id)
        // Only from where we found it. If the card went through in the
        // meantime, this matches nothing and the booking stands.
        .eq("status", "upcoming")
        .is("captured_at", null);
      if (updateError) throw updateError;

      released += 1;
    } catch (failure) {
      releaseFailed += 1;
      console.error(`Could not release abandoned booking ${booking.id}:`, describe(failure));
    }
  }

  return { released, releaseFailed };
}

/**
 * Pay hosts for sessions that have happened.
 *
 * The practitioner's money was taken when they booked and has been sitting in
 * our balance since. This is the moment it stops being ours to give back and
 * becomes the host's — which is exactly why it waits until the session has
 * started rather than happening at the point of sale.
 *
 * A late cancellation is included on purpose. Cancelling inside 24 hours
 * charges in full precisely because the host kept the hour free, so they are
 * paid the same as if the practitioner had turned up. A host cancellation is
 * not: that money went back to the practitioner, and `refunded_at` is how this
 * query knows.
 *
 * Failures are collected rather than thrown. One host with a closed account
 * must not stop the other twenty from being paid.
 */
async function payHostsForFinishedSessions(
  now: Date,
): Promise<{ paid: number; failed: number }> {
  const admin = supabaseAdmin();

  const { data: due, error } = await admin
    .from("bookings")
    .select(
      "id, space_id, practitioner_id, stripe_payment_intent_id, host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents, total_cents, platform_cents, status, spaces!inner(host_id)",
    )
    .lte("starts_at", now.toISOString())
    .not("captured_at", "is", null)
    .is("refunded_at", null)
    .is("host_paid_at", null)
    .in("status", ["upcoming", "completed", "cancelled_by_practitioner", "no_show"]);

  if (error) throw error;
  if (!due?.length) return { paid: 0, failed: 0 };

  let paid = 0;
  let failed = 0;

  for (const booking of due) {
    try {
      const hostId = (booking.spaces as unknown as { host_id: string }).host_id;

      const { data: host } = await admin
        .from("profiles")
        .select("stripe_connect_account_id")
        .eq("id", hostId)
        .maybeSingle();

      if (!host?.stripe_connect_account_id) {
        // Not an error to retry blindly: the host has not finished onboarding.
        // Left unpaid and visible, because the operations page lists hosts who
        // cannot be paid and this is one of them.
        failed += 1;
        console.error(`No connected account for host ${hostId} — booking ${booking.id}`);
        continue;
      }

      const { transferId } = await payHost(
        {
          hostRateCents: booking.host_rate_cents,
          serviceFeeCents: booking.service_fee_cents,
          instantFeeCents: booking.instant_fee_cents,
          proDiscountCents: booking.pro_discount_cents,
          totalCents: booking.total_cents,
          platformCents: booking.platform_cents,
        },
        host.stripe_connect_account_id,
        booking.stripe_payment_intent_id,
        {
          bookingId: booking.id,
          spaceId: booking.space_id,
          practitionerId: booking.practitioner_id,
        },
      );

      /*
       * Written after Stripe confirms, so a failure leaves the row untouched
       * and the next sweep tries again. The transfer itself is idempotent on
       * the booking id, so a crash between the two cannot pay twice.
       */
      await admin
        .from("bookings")
        .update({
          host_paid_at: new Date().toISOString(),
          stripe_transfer_id: transferId,
          // A session that ran and was not cancelled is now done. A cancelled
          // one keeps the status that says who cancelled it.
          ...(booking.status === "upcoming" ? { status: "completed" } : {}),
        })
        .eq("id", booking.id);

      paid += 1;
    } catch (failure) {
      failed += 1;
      console.error(`Payout failed for booking ${booking.id}:`, failure);
    }
  }

  return { paid, failed };
}

/**
 * Tell practitioners their door code has unlocked.
 *
 * The code itself needs no job — see the note at the top of this file. This is
 * only the message, and it is the one the whole notification queue exists for:
 * somebody is about to stand in front of a door.
 *
 * Wrapped so a notification failure cannot take down the capture result that
 * was already computed. Nothing here is worth reporting a failed cron run for.
 */
async function announceAccessCodes(now: Date): Promise<{ announced: number }> {
  try {
    return await notifyAccessCodesReady(supabaseAdmin(), now);
  } catch (error) {
    console.error("Access code announcements failed:", describe(error));
    return { announced: 0 };
  }
}

/** Second chance for anything a provider refused for a reason that may have passed. */
async function retryFailedNotifications(): Promise<{ notificationsSent: number }> {
  try {
    const admin = supabaseAdmin();
    const { sent } = await retryPending(await rebuildPending(admin));
    return { notificationsSent: sent };
  } catch (error) {
    console.error("Notification retries failed:", describe(error));
    return { notificationsSent: 0 };
  }
}
