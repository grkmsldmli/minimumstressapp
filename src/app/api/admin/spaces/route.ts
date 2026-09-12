import type { NextRequest } from "next/server";

import { loadDirectory } from "@/lib/admin/directory";
import { adminGet } from "@/lib/admin/guard";
import { filterSpaces, paginate } from "@/lib/admin/projections";

/**
 * The spaces directory: every room, whatever its status, searchable by
 * name/address/host and filterable by status, paginated.
 */
export function GET(request: NextRequest): Promise<Response> {
  return adminGet(async (admin) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const status = searchParams.get("status") ?? "all";
    const page = Number(searchParams.get("page") ?? "1");
    const dir = await loadDirectory(admin);
    const filtered = filterSpaces(dir.spaces, { q, status });
    return { ...paginate(filtered, page), query: { q, status } };
  });
}
