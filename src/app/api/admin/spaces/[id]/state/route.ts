import type { NextRequest } from "next/server";

import { recordAdminAction } from "@/lib/admin/audit";
import { staffOrRefusal } from "@/lib/admin/guard";
import { handled, jsonError } from "@/lib/api/session";
import { jsonObject, oneOf, optionalString, uuid } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";

const ACTIONS = [
  "approve",
  "send_to_review",
  "hide",
  "restore_live",
  "archive",
  "delete",
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
    if (["send_to_review", "hide", "archive", "delete"].includes(action.value) && reason.length < 3) {
      return jsonError("Add a short reason so the intervention is auditable.", 400);
    }

    const admin = supabaseAdmin();
    const { data: listing, error: readError } = await admin
      .from("spaces")
      .select("id, status, archived_at, sublease_doc_state")
      .eq("id", id.value)
      .maybeSingle();
    if (readError) throw readError;
    if (!listing) return jsonError("No such listing", 404);

    const done = async (metadata: Record<string, unknown> = {}): Promise<Response> => {
      await recordAdminAction(admin, {
        adminUserId: staff.staffId,
        adminEmail: staff.staffEmail,
        action: `listing_${action.value}`,
        targetType: "listing",
        targetId: id.value,
        reason: reason || null,
        metadata: {
          fromStatus: listing.status,
          fromArchivedAt: listing.archived_at,
          ...metadata,
        },
      });
      return Response.json({ ok: true });
    };

    switch (action.value) {
      case "approve": {
        if (listing.status !== "pending") return jsonError("Only a pending listing can be approved.", 409);
        const { error } = await admin
          .from("spaces")
          .update({
            status: "active",
            archived_at: null,
            sublease_doc_state: "verified",
            sublease_doc_reviewed_at: new Date().toISOString(),
            doc_review_note: null,
          })
          .eq("id", id.value);
        if (error) {
          return jsonError(
            /sublease/i.test(error.message)
              ? "This listing has no valid sublease document, so it cannot go live."
              : error.message,
            400,
          );
        }
        return done({ toStatus: "active" });
      }

      case "send_to_review": {
        const { error } = await admin
          .from("spaces")
          .update({ status: "pending", archived_at: null })
          .eq("id", id.value);
        if (error) throw error;
        return done({ toStatus: "pending" });
      }

      case "hide": {
        const { error } = await admin
          .from("spaces")
          .update({ status: "delisted", archived_at: null })
          .eq("id", id.value);
        if (error) throw error;
        return done({ toStatus: "delisted" });
      }

      case "restore_live": {
        if (listing.sublease_doc_state !== "verified") {
          return jsonError("The listing is not verified. Send it to review instead of forcing it live.", 409);
        }
        const { error } = await admin
          .from("spaces")
          .update({ status: "active", archived_at: null })
          .eq("id", id.value);
        if (error) throw error;
        return done({ toStatus: "active" });
      }

      case "archive": {
        const archivedAt = new Date().toISOString();
        const { error } = await admin
          .from("spaces")
          .update({ status: "delisted", archived_at: archivedAt })
          .eq("id", id.value);
        if (error) throw error;
        return done({ toStatus: "delisted", archivedAt });
      }

      case "delete": {
        const { error } = await admin.from("spaces").delete().eq("id", id.value);
        if (error) {
          return jsonError(
            /foreign key|violates|constraint/i.test(error.message)
              ? "This listing has booking history and cannot be deleted. Hide or archive it instead."
              : error.message,
            409,
          );
        }
        return done({ deleted: true });
      }
    }
  });
}
