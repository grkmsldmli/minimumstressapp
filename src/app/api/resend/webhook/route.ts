import {
  parseResendWebhook,
  verifyResendWebhook,
} from "@/lib/resend/webhook";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Resend delivery receipts. This route is public because Resend calls it, but
 * the exact raw body must carry a fresh valid Svix signature before it is
 * parsed or allowed anywhere near the database.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("Resend webhook is disabled: RESEND_WEBHOOK_SECRET is not set");
    return json({ error: "Webhook unavailable" }, 500);
  }

  const rawBody = await request.text();
  try {
    verifyResendWebhook(rawBody, request.headers, secret);
  } catch {
    return json({ error: "Invalid webhook signature" }, 400);
  }

  const parsed = parseResendWebhook(rawBody);
  if (parsed.kind === "invalid") return json({ error: "Invalid webhook payload" }, 400);
  if (parsed.kind === "ignored") return json({ received: true, ignored: true }, 200);

  const svixId = request.headers.get("svix-id")!;
  const admin = supabaseAdmin();
  const { error } = await admin.from("resend_email_events").insert({
    svix_id: svixId,
    resend_email_id: parsed.event.emailId,
    notification_correlation_id: parsed.event.correlationId,
    event_type: parsed.event.type,
    event_created_at: parsed.event.createdAt,
  });

  // A real Resend retry carries the same svix-id. The primary-key collision is
  // success: the immutable fact is already present and no work was lost.
  const duplicate = error?.code === "23505";
  if (error && !duplicate) {
    console.error("Resend webhook delivery evidence could not be stored");
    return json({ error: "Webhook persistence failed" }, 500);
  }

  // Always reconcile, including on a replay. If event storage succeeded but
  // this update failed, Resend retries; the duplicate event is then harmless
  // and the notification state still catches up.
  const { error: correlationError } = await admin.rpc("apply_resend_delivery_event", {
    p_resend_email_id: parsed.event.emailId,
    p_notification_correlation_id: parsed.event.correlationId,
    p_event_type: parsed.event.type,
    p_event_created_at: parsed.event.createdAt,
  });
  if (correlationError) {
    console.error("Resend webhook delivery state could not be correlated");
    return json({ error: "Webhook persistence failed" }, 500);
  }

  return json({ received: true, ...(duplicate ? { duplicate: true } : {}) }, 200);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
