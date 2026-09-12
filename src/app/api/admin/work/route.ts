import { loadDirectory } from "@/lib/admin/directory";
import { adminGet } from "@/lib/admin/guard";
import { type RawWorkInterest, type RawWorkRequest, workView } from "@/lib/admin/work-view";

/**
 * Work: the coverage board by state, and the open requests nobody has covered
 * yet. Real rows only; host names reuse the directory so the links resolve.
 */
export function GET(): Promise<Response> {
  return adminGet(async (admin) => {
    const [dir, requestsRes, interestRes] = await Promise.all([
      loadDirectory(admin),
      admin
        .from("work_requests")
        .select("id, host_id, title, profession, starts_at, ends_at, pay_cents, urgent, state, created_at, filled_at")
        .order("starts_at", { ascending: true }),
      admin.from("work_interest").select("request_id, state"),
    ]);
    return workView(
      (requestsRes.data ?? []) as RawWorkRequest[],
      (interestRes.data ?? []) as RawWorkInterest[],
      dir.people,
    );
  });
}
