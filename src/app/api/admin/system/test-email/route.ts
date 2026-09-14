import type { NextRequest } from "next/server";

import { recordAdminAction } from "@/lib/admin/audit";
import {
  emailDeliveryConfigurationFingerprint,
  recordEmailDeliveryProbe,
} from "@/lib/admin/email-delivery";
import { staffOrRefusal } from "@/lib/admin/guard";
import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { emailWebhookConfigured, sendEmail } from "@/lib/notify/transports";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Send one real diagnostic message to the signed-in staff account.
 *
 * There is intentionally no recipient in the request body: this route cannot
 * become a staff-authenticated mail relay. Resend accepting the call returns
 * 202; only the later signed `email.delivered` webhook can turn health green.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const staff = await staffOrRefusal();
    if (staff instanceof Response) return staff;

    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return jsonError("Cross-origin request is not allowed", 403);
    }
    if (!staff.staffEmail) return jsonError("The staff account has no email address", 409);
    if (!emailWebhookConfigured()) {
      return jsonError("Resend API or webhook signing is not configured", 409);
    }
    const configurationFingerprint = emailDeliveryConfigurationFingerprint();
    if (!configurationFingerprint) {
      return jsonError("Resend API or webhook signing is not configured", 409);
    }

    const limited = check(
      "admin-email-test",
      identify(request, staff.staffId),
      LIMITS.adminEmailTest,
    );
    if (!limited.ok) return tooManyRequests(limited);

    const rateBucket = Math.floor(Date.now() / LIMITS.adminEmailTest.windowMs);
    const result = await sendEmail(
      staff.staffEmail,
      {
        subject: "Minimum Stress email delivery check",
        body:
          "This is the delivery check you requested from Command Center. " +
          "No action is needed. When this message reaches your mail server, " +
          "Resend reports that signed result back to Minimum Stress.",
        sms: null,
      },
      {
        idempotencyKey:
          `email-health-${staff.staffId}-${rateBucket}-${configurationFingerprint}`,
      },
    );

    const admin = supabaseAdmin();
    if (result.status === "sent" && !(await recordEmailDeliveryProbe(admin, result.id))) {
      await recordAdminAction(admin, {
        adminUserId: staff.staffId,
        adminEmail: staff.staffEmail,
        action: "send_email_delivery_test",
        targetType: "system",
        targetId: result.id === "unknown" ? null : result.id,
        metadata: { provider: "resend", outcome: "evidence_not_recorded" },
      });
      return jsonError("The delivery check could not be recorded", 500);
    }

    await recordAdminAction(admin, {
      adminUserId: staff.staffId,
      adminEmail: staff.staffEmail,
      action: "send_email_delivery_test",
      targetType: "system",
      targetId: result.status === "sent" ? result.id : null,
      metadata: { provider: "resend", outcome: result.status },
    });

    if (result.status !== "sent") {
      return jsonError("Resend did not accept the delivery check", 502);
    }

    return Response.json(
      { accepted: true, message: "Waiting for signed delivery confirmation" },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  });
}
