import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminListingAction =
  | "approve"
  | "reject"
  | "send_to_review"
  | "hide"
  | "restore_live"
  | "archive"
  | "delete"
  | "approve_closure"
  | "reject_closure";

/** Listing mutation + audit row, committed atomically by migration 0079. */
export async function applyAdminListingAction(
  admin: SupabaseClient,
  input: {
    spaceId: string;
    action: AdminListingAction;
    adminUserId: string;
    adminEmail: string | null;
    reason?: string | null;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("admin_apply_listing_action", {
    p_space_id: input.spaceId,
    p_action: input.action,
    p_admin_user_id: input.adminUserId,
    p_admin_email: input.adminEmail,
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? {};
}
