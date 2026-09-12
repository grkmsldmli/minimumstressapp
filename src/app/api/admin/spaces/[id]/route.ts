import type { NextRequest } from "next/server";

import { loadDirectory } from "@/lib/admin/directory";
import { adminGet, notFoundJson } from "@/lib/admin/guard";
import { spaceDetail } from "@/lib/admin/projections";

/** One room: its host, its money and its full booking history. */
export function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return adminGet(async (admin) => {
    const { id } = await ctx.params;
    const detail = spaceDetail(await loadDirectory(admin), id);
    if (!detail) return notFoundJson();

    const { data, error } = await admin
      .from("listing_closure_requests")
      .select("id, reason, detail, state, requested_at, resolved_at, resolution_note")
      .eq("space_id", id)
      .order("requested_at", { ascending: false });
    if (error) throw error;

    return {
      ...detail,
      closureRequests: (data ?? []).map((request) => ({
        id: request.id as string,
        reason: request.reason as string,
        detail: (request.detail as string | null) ?? null,
        state: request.state as "open" | "approved" | "rejected",
        requestedAt: request.requested_at as string,
        resolvedAt: (request.resolved_at as string | null) ?? null,
        resolutionNote: (request.resolution_note as string | null) ?? null,
      })),
    };
  });
}
