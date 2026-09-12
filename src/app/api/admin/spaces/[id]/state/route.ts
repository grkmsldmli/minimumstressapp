import type { NextRequest } from "next/server";

import { staffOrRefusal } from "@/lib/admin/guard";
import { applyAdminListingAction } from "@/lib/admin/listing-actions";
import { handled, jsonError } from "@/lib/api/session";
import { jsonObject, oneOf, optionalString, uuid } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";

const ACTIONS = [
  "approve",
  "reject",
  "send_to_review",
  "hide",
  "restore_live",
  "archive",
  "delete",
  "approve_closure",
  "reject_closure",
] as const;

/**
 * Operator-only listing lifecycle controls for Command Center.
 *
 * There is deliberately no generic "set status" endpoint. Each transition has
 * a business meaning, a confirmation in the UI, and an audit row. Bookings are
 * not touched here: their state is tied to Stripe/refund/cancellation flows and
 * must never be hand-edited as if it were a listing flag.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handled(async () => {
    const staff = await staffOrRefusal();
    if (staff instanceof Response) return staff;

    const { id: rawId } = await ctx.params;
    const id = uuid({ id: rawId }, "id");
    if (!id.ok) return jsonError(id.reason, 400);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);
    const action = oneOf(body.value, "action", ACTIONS);
    if (!action.ok) return jsonError(action.reason, 400);
    const note = optionalString(body.value, "note", { max: 2000 });
    if (!note.ok) return jsonError(note.reason, 400);

    const reason = note.value.trim();
    if (
      [
        "reject",
        "send_to_review",
        "hide",
        "restore_live",
        "archive",
        "delete",
        "approve_closure",
        "reject_closure",
      ].includes(action.value) &&
      reason.length < 3
    ) {
      return jsonError("Add a short reason so the intervention is auditable.", 400);
    }

    const admin = supabaseAdmin();
    try {
      const result = await applyAdminListingAction(admin, {
        spaceId: id.value,
        action: action.value,
        adminUserId: staff.staffId,
        adminEmail: staff.staffEmail,
        reason,
      });
      return Response.json({ ok: true, ...result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The listing action failed.";
      if (/no such listing/i.test(message)) return jsonError("No such listing", 404);
      if (
        /booking history|closure history|only a|not verified|closure request|hide the live|archived listing/i.test(
          message,
        )
      ) {
        return jsonError(message, 409);
      }
      return jsonError(message, 400);
    }
  });
}
