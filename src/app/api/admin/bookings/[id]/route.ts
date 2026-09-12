import type { NextRequest } from "next/server";

import { loadDirectory } from "@/lib/admin/directory";
import { adminGet, notFoundJson } from "@/lib/admin/guard";
import { bookingDetail } from "@/lib/admin/projections";

/**
 * One booking, with both parties and the room linked, and the money kept as
 * three distinct figures — what the practitioner paid, what the host earns, and
 * our fee — never rolled into one.
 */
export function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return adminGet(async (admin) => {
    const { id } = await ctx.params;
    const detail = bookingDetail(await loadDirectory(admin), id);
    return detail ?? notFoundJson();
  });
}
