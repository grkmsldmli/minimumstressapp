import type { NextRequest } from "next/server";

import { loadDirectory } from "@/lib/admin/directory";
import { adminGet } from "@/lib/admin/guard";
import { filterPeople, paginate, toListPerson } from "@/lib/admin/projections";

/**
 * The people directory: every account, searchable by name/email/id and
 * filterable by type, paginated. Staff-gated by adminGet; the service role is
 * the only way to resolve emails at all, so the gate is the whole boundary.
 */
export function GET(request: NextRequest): Promise<Response> {
  return adminGet(async (admin) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const type = searchParams.get("type") ?? "all";
    const page = Number(searchParams.get("page") ?? "1");
    const dir = await loadDirectory(admin);
    const filtered = filterPeople(dir.people, { q, type });
    const listed = paginate(filtered, page);
    // Emergency contact is never sent in a list — only the detail route carries it.
    return { ...listed, items: listed.items.map(toListPerson), query: { q, type } };
  });
}
