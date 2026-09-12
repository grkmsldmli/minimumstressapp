import type { NextRequest } from "next/server";

import { recordAdminAction } from "@/lib/admin/audit";
import { staffOrRefusal } from "@/lib/admin/guard";
import { applyAdminListingAction } from "@/lib/admin/listing-actions";
import { loadReportingQueue } from "@/lib/admin/reporting-truth";
import { handled, jsonError } from "@/lib/api/session";
import { dateOnly, integer, jsonObject, oneOf, optionalString, uuid } from "@/lib/api/validate";
import { ClaimError, decideClaim } from "@/lib/claim-service";
import { CLAIM_CAP_CENTS } from "@/lib/claims";
import { formatCoverageDate } from "@/lib/format-date";
import { notifyInsuranceReviewed } from "@/lib/notify/for-insurance";
import { RefundError, decideRefund } from "@/lib/refund-service";
import { supabaseAdmin } from "@/lib/supabase/server";

const AUDIT_TARGET: Record<string, string> = {
  approve_listing: "listing",
  reject_listing: "listing",
  resolve_escalation: "escalation",
  approve_account_change: "account_change_request",
  decide_refund: "refund_request",
  decide_claim: "studio_claim",
  verify_insurance: "profile",
  reject_insurance: "profile",
  verify_credential: "profile",
  reject_credential: "profile",
};

export async function GET(): Promise<Response> {
  return handled(async () => {
    const staff = await staffOrRefusal();
    if (staff instanceof Response) return staff;

    // The legacy Operations surface must read through the same reporting
    // boundary as Command/Money/Growth/System. Raw checkout-hold rows are
    // implementation details, not bookings or cancellations.
    return Response.json(await loadReportingQueue(supabaseAdmin()), {
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
      "verify_insurance",
      "reject_insurance",
      "verify_credential",
      "reject_credential",
    ] as const);
    if (!action.ok) return jsonError(action.reason, 400);

    const id = uuid(body.value, "id");
    if (!id.ok) return jsonError(id.reason, 400);

    const note = optionalString(body.value, "note", { max: 2000 });
    if (!note.ok) return jsonError(note.reason, 400);

    const admin = supabaseAdmin();

    const done = async (
      extra: Record<string, unknown> = {},
      metadata: Record<string, unknown> = {},
    ): Promise<Response> => {
      await recordAdminAction(admin, {
        adminUserId: staff.staffId,
        adminEmail: staff.staffEmail,
        action: action.value,
        targetType: AUDIT_TARGET[action.value] ?? null,
        targetId: id.value,
        reason: note.value || null,
        metadata,
      });
      return Response.json({ ok: true, ...extra });
    };

    switch (action.value) {
      case "approve_listing": {
        try {
          await applyAdminListingAction(admin, {
            spaceId: id.value,
            action: "approve",
            adminUserId: staff.staffId,
            adminEmail: staff.staffEmail,
          });
          return Response.json({ ok: true });
        } catch (cause) {
          return jsonError(cause instanceof Error ? cause.message : "Approval failed.", 409);
        }
      }

      case "reject_listing": {
        if (note.value.trim().length < 3) return jsonError("Add a reason for the host.", 400);
        try {
          await applyAdminListingAction(admin, {
            spaceId: id.value,
            action: "reject",
            adminUserId: staff.staffId,
            adminEmail: staff.staffEmail,
            reason: note.value,
          });
          return Response.json({ ok: true });
        } catch (cause) {
          return jsonError(cause instanceof Error ? cause.message : "Rejection failed.", 409);
        }
      }

      case "resolve_escalation": {
        const { error } = await admin
          .from("review_escalations")
          .update({
            state: "resolved",
            resolved_at: new Date().toISOString(),
            note: note.value || "Reviewed, no action needed.",
          })
          .eq("id", id.value);
        if (error) throw error;
        return done();
      }

      case "approve_account_change": {
        const { data: request_, error: readError } = await admin
          .from("account_type_change_requests")
          .select("user_id, requested_type")
          .eq("id", id.value)
          .maybeSingle();

        if (readError) throw readError;
        if (!request_) return jsonError("No such request", 404);

        const { error } = await admin
          .from("profiles")
          .update({ account_type: request_.requested_type })
          .eq("id", request_.user_id);
        if (error) throw error;

        await admin
          .from("account_type_change_requests")
          .update({ state: "approved", resolved_at: new Date().toISOString() })
          .eq("id", id.value);

        return done();
      }

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
          return done({ refundedCents }, { outcome: outcome.value, refundedCents });
        } catch (failure) {
          if (failure instanceof RefundError) return jsonError(failure.message, failure.status);
          throw failure;
        }
      }

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
          return done(result, { verdict: verdict.value, amountCents: amount.value, ...result });
        } catch (failure) {
          if (failure instanceof ClaimError) return jsonError(failure.message, failure.status);
          throw failure;
        }
      }

      case "verify_insurance": {
        const effective = dateOnly(body.value, "effectiveDate");
        if (!effective.ok) return jsonError(effective.reason, 400);
        const expires = dateOnly(body.value, "expiresAt");
        if (!expires.ok) return jsonError(expires.reason, 400);
        if (expires.value < effective.value) {
          return jsonError("The expiry cannot come before the effective date", 400);
        }

        const insurer = optionalString(body.value, "insurer", { max: 200 });
        if (!insurer.ok) return jsonError(insurer.reason, 400);
        const policyNumber = optionalString(body.value, "policyNumber", { max: 200 });
        if (!policyNumber.ok) return jsonError(policyNumber.reason, 400);

        const { data, error } = await admin
          .from("profiles")
          .update({
            insurance_doc_state: "verified",
            insurance_doc_reviewed_at: new Date().toISOString(),
            insurance_effective_date: effective.value,
            insurance_expires_at: expires.value,
            insurance_insurer: insurer.value || null,
            insurance_policy_number: policyNumber.value || null,
            insurance_review_note: null,
          })
          .eq("id", id.value)
          .eq("account_type", "practitioner")
          .select("insurance_doc_path");

        if (error) {
          return jsonError(
            /insurance_dates|check constraint/i.test(error.message)
              ? "Those dates do not make a valid window — check the certificate."
              : error.message,
            400,
          );
        }

        const verified = data?.[0];
        if (verified?.insurance_doc_path) {
          await notifyInsuranceReviewed(admin, id.value, {
            outcome: "verified",
            certificate: verified.insurance_doc_path,
            expiresLabel: formatCoverageDate(expires.value),
          });
        }
        return done();
      }

      case "reject_insurance": {
        if (!note.value || note.value.trim().length < 15) {
          return jsonError("Say why — it is shown to them", 400);
        }

        const { data, error } = await admin
          .from("profiles")
          .update({
            insurance_doc_state: "rejected",
            insurance_doc_reviewed_at: new Date().toISOString(),
            insurance_effective_date: null,
            insurance_expires_at: null,
            insurance_review_note: note.value,
          })
          .eq("id", id.value)
          .eq("account_type", "practitioner")
          .select("insurance_doc_path");
        if (error) throw error;

        const rejected = data?.[0];
        if (rejected?.insurance_doc_path) {
          await notifyInsuranceReviewed(admin, id.value, {
            outcome: "rejected",
            certificate: rejected.insurance_doc_path,
            note: note.value,
          });
        }
        return done();
      }

      case "verify_credential": {
        const { error } = await admin
          .from("profiles")
          .update({
            credential_doc_state: "verified",
            credential_doc_reviewed_at: new Date().toISOString(),
            credential_review_note: null,
          })
          .eq("id", id.value)
          .eq("account_type", "practitioner")
          .not("credential_doc_path", "is", null);
        if (error) throw error;
        return done();
      }

      case "reject_credential": {
        if (!note.value || note.value.trim().length < 15) {
          return jsonError("Say why — it is shown to them", 400);
        }
        const { error } = await admin
          .from("profiles")
          .update({
            credential_doc_state: "rejected",
            credential_doc_reviewed_at: new Date().toISOString(),
            credential_review_note: note.value,
          })
          .eq("id", id.value)
          .eq("account_type", "practitioner")
          .not("credential_doc_path", "is", null);
        if (error) throw error;
        return done();
      }

      default:
        return jsonError("Unknown action", 400);
    }
  });
}
