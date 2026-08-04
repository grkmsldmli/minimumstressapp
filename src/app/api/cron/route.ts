import type { NextRequest } from "next/server";

import { notifyAccessCodesReady, rebuildPending } from "@/lib/notify/for-booking";
import { retryPending } from "@/lib/notify/send";
import { stripe } from "@/lib/stripe/client";
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
     * Sequential, and capture goes first.
     *
     * If the run is cut short — a function timeout, a deploy mid-run — the
     * thing that must already have happened is taking the money for sessions
     * that started. A door-code email is recoverable on the next pass; a
     * capture that never happens is a host who is not paid.
     */
    const captured = await captureDue(now);
    const announced = await announceAccessCodes(now);
    const retried = await retryFailedNotifications();

    return Response.json({ ranAt: now.toISOString(), ...captured, ...announced, ...retried });
  } catch (error) {
    // Supabase rejects with a plain object rather than an Error, so the default
    // logging renders it as `{}` — useless at 3am when a capture run has
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
 * Capture payment for sessions that have started.
 *
 * This is the moment the brief's whole cancellation model turns on: until now
 * the card was only authorised, which is what made a 24-hour release cost the
 * practitioner nothing.
 *
 * Failures are collected rather than thrown. One expired authorization must not
 * stop the other twenty bookings in the batch from being captured.
 */
async function captureDue(now: Date): Promise<{ captured: number; failed: number }> {
  const admin = supabaseAdmin();

  const { data: due, error } = await admin
    .from("bookings")
    .select("id, stripe_payment_intent_id, total_cents")
    .eq("status", "upcoming")
    .lte("starts_at", now.toISOString())
    .is("captured_at", null)
    .not("stripe_payment_intent_id", "is", null);

  if (error) throw error;
  if (!due?.length) return { captured: 0, failed: 0 };

  let captured = 0;
  let failed = 0;

  for (const booking of due) {
    try {
      await stripe().paymentIntents.capture(booking.stripe_payment_intent_id!, {
        amount_to_capture: booking.total_cents,
      });

      // Written after Stripe confirms, so a failure leaves the row untouched
      // and the next run tries again rather than marking it done.
      await admin
        .from("bookings")
        .update({ captured_at: new Date().toISOString(), status: "completed" })
        .eq("id", booking.id);

      captured += 1;
    } catch (failure) {
      failed += 1;
      console.error(`Capture failed for booking ${booking.id}:`, failure);
    }
  }

  return { captured, failed };
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
