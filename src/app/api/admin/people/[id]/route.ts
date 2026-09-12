import type { NextRequest } from "next/server";

import { loadDirectory } from "@/lib/admin/directory";
import { adminGet, notFoundJson } from "@/lib/admin/guard";
import { personDetail } from "@/lib/admin/projections";

/**
 * One person, everything an operator asks about them: identity, standing, the
 * money split (earned vs spent, never summed), their rooms and their sessions on
 * both sides. Emergency contact is here because staff are the only ones allowed
 * to read it and the one moment it matters is a call nobody else can make.
 */
export function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return adminGet(async (admin) => {
    const { id } = await ctx.params;
    const detail = personDetail(await loadDirectory(admin), id);
    return detail ?? notFoundJson();
  });
}
