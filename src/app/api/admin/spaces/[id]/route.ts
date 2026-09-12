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
    return detail ?? notFoundJson();
  });
}
