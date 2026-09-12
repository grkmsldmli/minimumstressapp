import type { NextRequest } from "next/server";

import { adminGet } from "@/lib/admin/guard";
import { paginate } from "@/lib/admin/projections";

export interface AuditRow {
  id: string;
  occurredAt: string;
  adminEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * The admin audit log: every staff decision, newest first, with who did it, to
 * what, and any recorded outcome. Read-only and staff-gated — the log of who
 * touched what is itself something only staff may read.
 */
export function GET(request: NextRequest): Promise<Response> {
  return adminGet(async (admin) => {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") ?? "1");
    const { data } = await admin
      .from("admin_audit_log")
      .select("id, occurred_at, admin_email, action, target_type, target_id, reason, metadata")
      .order("occurred_at", { ascending: false })
      .limit(1000);
    const rows: AuditRow[] = (data ?? []).map((r) => ({
      id: r.id as string,
      occurredAt: r.occurred_at as string,
      adminEmail: (r.admin_email as string) ?? null,
      action: r.action as string,
      targetType: (r.target_type as string) ?? null,
      targetId: (r.target_id as string) ?? null,
      reason: (r.reason as string) ?? null,
      metadata: (r.metadata as Record<string, unknown>) ?? null,
    }));
    return paginate(rows, page, 50);
  });
}
