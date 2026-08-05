import type { NextRequest } from "next/server";

import { isStaff } from "@/lib/admin/access";
import { loadQueue } from "@/lib/admin/queue";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { jsonObject, oneOf, optionalString, uuid } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The staff queue, and the decisions taken on it.
 *
 * The allowlist is checked on every request rather than once at sign-in. A
 * session that was staff yesterday is not staff today if the setting changed,
 * and the thing behind this route is every lease document in the database.
 *
 * The failure is a 404, not a 403. A 403 confirms the route exists and that
 * somebody is on the other side of it; a 404 says nothing at all, which is what
 * an address nobody should have found deserves.
 */
/**
 * Null when the caller is staff; a 404 when they are not.
 *
 * Returning the refusal rather than a union of shapes, because `in` narrowing
 * against optional properties still leaves the value possibly undefined and
 * every call site then has to prove something it already knows.
 */
async function refuseNonStaff(): Promise<Response | null> {
  const auth = await requireUser();
  if ("response" in auth) return new Response("Not found", { status: 404 });

  if (!isStaff(auth.user.email)) {
    // Logged, because somebody reaching this is either a mistake worth knowing
    // about or an attempt worth knowing about, and both look identical here.
    console.warn(`Non-staff account reached /api/admin: ${auth.user.id}`);
    return new Response("Not found", { status: 404 });
  }

  return null;
}

export async function GET(): Promise<Response> {
  return handled(async () => {
    const refusal = await refuseNonStaff();
    if (refusal) return refusal;

    return Response.json(await loadQueue(supabaseAdmin()), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const refusal = await refuseNonStaff();
    if (refusal) return refusal;

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const action = oneOf(body.value, "action", [
      "approve_listing",
      "reject_listing",
      "resolve_escalation",
      "approve_account_change",
    ] as const);
    if (!action.ok) return jsonError(action.reason, 400);

    const id = uuid(body.value, "id");
    if (!id.ok) return jsonError(id.reason, 400);

    const note = optionalString(body.value, "note", { max: 2000 });
    if (!note.ok) return jsonError(note.reason, 400);

    const admin = supabaseAdmin();

    switch (action.value) {
      case "approve_listing": {
        /**
         * The database refuses this without a sublease document — see the
         * check constraint in 0010. So a listing whose paperwork never
         * uploaded cannot be approved by clicking quickly, which is the whole
         * reason that constraint is on the row rather than in a comment.
         */
        const { error } = await admin
          .from("spaces")
          .update({ status: "active" })
          .eq("id", id.value)
          .eq("status", "pending");

        if (error) {
          return jsonError(
            error.message.includes("sublease")
              ? "That listing has no sublease document — it cannot go live."
              : error.message,
            400,
          );
        }
        return Response.json({ ok: true });
      }

      case "reject_listing": {
        // Delisted rather than deleted: the host's own record of what they
        // submitted survives, and so does ours of what we decided.
        const { error } = await admin
          .from("spaces")
          .update({ status: "delisted" })
          .eq("id", id.value);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      case "resolve_escalation": {
        const { error } = await admin
          .from("review_escalations")
          .update({
            state: "resolved",
            resolved_at: new Date().toISOString(),
            // The note is what makes a resolution auditable. An escalation
            // closed with nothing written is indistinguishable from one nobody
            // read.
            note: note.value || "Reviewed, no action needed.",
          })
          .eq("id", id.value);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      case "approve_account_change": {
        const { data: request_, error: readError } = await admin
          .from("account_type_change_requests")
          .select("user_id, requested_type")
          .eq("id", id.value)
          .maybeSingle();

        if (readError) throw readError;
        if (!request_) return jsonError("No such request", 404);

        // The service role is exempt from the trigger that otherwise makes
        // account_type write-once — which is exactly the exemption that lets a
        // genuine mistake be corrected without making the rule meaningless.
        const { error } = await admin
          .from("profiles")
          .update({ account_type: request_.requested_type })
          .eq("id", request_.user_id);
        if (error) throw error;

        await admin
          .from("account_type_change_requests")
          .update({ state: "approved", resolved_at: new Date().toISOString() })
          .eq("id", id.value);

        return Response.json({ ok: true });
      }

      default:
        // Unreachable: `oneOf` already rejected anything else. Present so the
        // function has a return type rather than a maybe.
        return jsonError("Unknown action", 400);
    }
  });
}
