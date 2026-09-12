import type { NextRequest } from "next/server";

import { loadDirectory } from "@/lib/admin/directory";
import { adminGet } from "@/lib/admin/guard";
import { searchDirectory } from "@/lib/admin/projections";

/**
 * Universal search: one term, across people, spaces and bookings, each result a
 * link into its detail page. Under two characters returns empty rather than the
 * whole table.
 */
export function GET(request: NextRequest): Promise<Response> {
  return adminGet(async (admin) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    return searchDirectory(await loadDirectory(admin), q);
  });
}
