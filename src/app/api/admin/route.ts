import type { NextRequest } from "next/server";

import { isStaff } from "@/lib/admin/access";
import { loadQueue } from "@/lib/admin/queue";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { integer, jsonObject, oneOf, optionalString, uuid } from "@/lib/api/validate";
import { ClaimError, decideClaim } from "@/lib/claim-service";
import { CLAIM_CAP_CENTS } from "@/lib/claims";
import { RefundError, decideRefund } from "@/lib/refund-service";
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
 * Who is asking, when they are staff; a 404 when they are not.
 *
 * It used to return null on success, which was enough while every action was
 * anonymous. A refund decision is not: it is written down with a name against
 * it, because "somebody approved this" is not an answer anyone can follow up.
 */
async function staffOrRefusal(): Promise<Response | { staffId: string }> {
  const auth = await requireUser();
  if ("response" in auth) return new Response("Not found", { status: 404 });

  if (!isStaff(auth.user.email)) {
    // Logged, because somebody reaching this is either a mistake worth knowing
    // about or an attempt worth knowing about, and both look identical here.
    console.warn(`Non-staff account reached /api/admin: ${auth.user.id}`);
    return new Response("Not found", { status: 404 });
  }

  return { staffId: auth.user.id };
}

export async function GET(): Promise<Response> {
  return handled(async () => {
    const staff = await staffOrRefusal();
    if (staff instanceof Response) return staff;

    return Response.json(await loadQueue(supabaseAdmin()), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const staff = await staffOrRefusal();
    if (staff instanceof Response) return staff;

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const action = oneOf(body.value, "action", [
      "approve_listing",
      "reject_listing",
      "resolve_escalation",
      "approve_account_change",
      "decide_refund",
      "decide_claim",
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
        /*
         * The document is marked read at the same moment the listing goes
         * live, in one write, because 0018 refuses an active listing whose
         * lease is not verified. Two updates could leave the pair disagreeing
         * if the second one failed; one cannot.
         *
         * This is also the only place the host learns anything. Until now the
         * app went quiet after an upload and "pending" covered three different
         * answers — not looked at, looked at and fine, looked at and wrong.
         */
        const reviewedAt = new Date().toISOString();
        const { error } = await admin
          .from("spaces")
          .update({
            status: "active",
            sublease_doc_state: "verified",
            sublease_doc_reviewed_at: reviewedAt,
            doc_review_note: null,
          })
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
          .update({
            status: "delisted",
            sublease_doc_state: "rejected",
            sublease_doc_reviewed_at: new Date().toISOString(),
            // Shown to the host verbatim, so a rejection can say "the second
            // page is cut off" rather than leaving them to guess.
            doc_review_note: note.value || null,
          })
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

      /**
       * The end of a refund request, and the only place money moves for one.
       *
       * A note is required rather than optional. It is quoted back to the
       * person who asked, and a refusal that explains itself is one they can
       * argue with — an unexplained one is a wall, and the person on the other
       * side of it writes to their bank instead, which costs everyone more
       * than the refund would have.
       */
      case "decide_refund": {
        const outcome = oneOf(body.value, "outcome", ["full", "our_fee", "none"] as const);
        if (!outcome.ok) return jsonError(outcome.reason, 400);

        if (!note.value || note.value.trim().length < 15) {
          return jsonError("Say why — it is quoted back to them", 400);
        }

        try {
          const { refundedCents } = await decideRefund(
            admin,
            id.value,
            staff.staffId,
            outcome.value,
            note.value,
          );
          return Response.json({ ok: true, refundedCents });
        } catch (failure) {
          if (failure instanceof RefundError) {
            return jsonError(failure.message, failure.status);
          }
          throw failure;
        }
      }

      /**
       * The end of a studio's claim, and the only place a practitioner's kept
       * card is charged for one.
       *
       * `amountCents` is what staff settled on and matters only for damage —
       * the fixed kinds are recomputed server-side, so a host cannot inflate a
       * published flat rate by editing a payload.
       *
       * An upheld claim whose card refuses comes back as `uncollectable`
       * rather than as an error. That is a real outcome with a real meaning
       * for the host: we agreed with you and still could not collect, which is
       * where your own insurer comes in.
       */
      case "decide_claim": {
        const verdict = oneOf(body.value, "verdict", ["uphold", "reject"] as const);
        if (!verdict.ok) return jsonError(verdict.reason, 400);

        if (!note.value || note.value.trim().length < 15) {
          return jsonError("Say why — both sides are told", 400);
        }

        const amount =
          body.value.amountCents === undefined
            ? { ok: true as const, value: 0 }
            : integer(body.value, "amountCents", { min: 1, max: CLAIM_CAP_CENTS });
        if (!amount.ok) return jsonError(amount.reason, 400);

        try {
          const result = await decideClaim(
            admin,
            id.value,
            staff.staffId,
            verdict.value === "uphold",
            amount.value,
            note.value,
          );
          return Response.json({ ok: true, ...result });
        } catch (failure) {
          if (failure instanceof ClaimError) {
            return jsonError(failure.message, failure.status);
          }
          throw failure;
        }
      }

      default:
        // Unreachable: `oneOf` already rejected anything else. Present so the
        // function has a return type rather than a maybe.
        return jsonError("Unknown action", 400);
    }
  });
}
