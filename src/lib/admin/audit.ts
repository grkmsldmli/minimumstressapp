import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The durable record of a state-changing admin action.
 *
 * "Never silently mutate production data without an audit trail." Every staff
 * decision that writes to the business — approving a listing, deciding a refund,
 * verifying insurance — records one of these, attributed to the acting staff
 * account. Metadata is safe, human-readable context only: ids, states, amounts,
 * a staff-typed reason — never documents, secrets, or personal data beyond the
 * target id.
 */
export interface AdminAuditEntry {
  adminUserId: string | null;
  adminEmail: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Write one audit row. Called AFTER the mutation has succeeded and awaited, so
 * the trail is durable and ordered; a failure here is logged loudly but does not
 * (and cannot cleanly) roll back the already-committed action — losing the audit
 * row must never look like the action failed. Writes via the service-role client.
 */
export async function recordAdminAction(
  admin: SupabaseClient,
  entry: AdminAuditEntry,
): Promise<void> {
  try {
    const { error } = await admin.from("admin_audit_log").insert({
      admin_user_id: entry.adminUserId,
      admin_email: entry.adminEmail,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) console.error(`audit: insert failed for "${entry.action}": ${error.message}`);
  } catch (cause) {
    console.error("audit: insert threw", cause);
  }
}
