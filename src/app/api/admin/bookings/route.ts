import type { NextRequest } from "next/server";

import { loadDirectory } from "@/lib/admin/directory";
import { adminGet } from "@/lib/admin/guard";
import { filterBookings, paginate } from "@/lib/admin/projections";

/**
 * The bookings directory: every booking, newest first, searchable by
 * space/practitioner/host and filterable by status, paginated. Never the message
 * thread — a booking here is who, when and how much, never what was said.
 */
export function GET(request: NextRequest): Promise<Response> {
  return adminGet(async (admin) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const status = searchParams.get("status") ?? "all";
    const page = Number(searchParams.get("page") ?? "1");
    const dir = await loadDirectory(admin);
    const filtered = filterBookings(dir.bookings, { q, status });
    return { ...paginate(filtered, page), query: { q, status } };
  });
}
