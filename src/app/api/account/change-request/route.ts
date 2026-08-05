import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, oneOf, optionalString } from "@/lib/api/validate";
import { notify } from "@/lib/notify/send";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Asking to move to the other side of the marketplace.
 *
 * The request is recorded and a person decides. Nothing here changes an
 * account: becoming a host means sublease proof, a legal acknowledgement and
 * payout setup, and becoming a practitioner means insurance — a switch that
 * skipped those would hand an account obligations it had never satisfied,
 * which is exactly what locking the column was for.
 *
 * `current_type` is read from the profile rather than taken from the body. A
 * caller who could state their own current type could describe a change they
 * are not actually making, and the record is the only thing a reviewer sees.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("account-change", identify(request, auth.user.id), LIMITS.accountChange);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const requested = oneOf(body.value, "requestedType", ["practitioner", "host"] as const);
    if (!requested.ok) return jsonError(requested.reason, 400);

    const reason = optionalString(body.value, "reason", { max: 1000 });
    if (!reason.ok) return jsonError(reason.reason, 400);

    const admin = supabaseAdmin();

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("account_type, display_name")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.account_type) {
      return jsonError("Choose an account type first", 400);
    }

    if (profile.account_type === requested.value) {
      return jsonError(`This account is already set up as a ${requested.value}.`, 400);
    }

    const { error } = await admin.from("account_type_change_requests").insert({
      user_id: auth.user.id,
      current_type: profile.account_type,
      requested_type: requested.value,
      reason: reason.value,
    });

    if (error) {
      // The partial unique index: one open request per person, so a refusal
      // cannot be answered by asking again immediately.
      if (error.code === "23505") {
        return jsonError("You already have a request open. We'll come back to you on it.", 409);
      }
      throw error;
    }

    const staffEmail = process.env.SAFETY_ALERT_EMAIL;
    if (staffEmail) {
      await notify({
        kind: "account_change_requested",
        recipient: { userId: auth.user.id, email: staffEmail },
        subjectId: `account-change:${auth.user.id}:${Date.now()}`,
        context: {
          name: profile.display_name ?? auth.user.email ?? "Someone",
          role: profile.account_type,
          reason: requested.value,
          note: reason.value,
        },
      });
    } else {
      console.error(
        `ACCOUNT CHANGE requested by ${auth.user.id} (${profile.account_type} → ${requested.value}) — SAFETY_ALERT_EMAIL is not set, so nobody was told.`,
      );
    }

    return Response.json({ ok: true }, { status: 201 });
  });
}
