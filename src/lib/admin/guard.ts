import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { handled, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";

import { isStaff } from "./access";

export interface StaffContext {
  staffId: string;
  staffEmail: string | null;
}

/**
 * The single staff gate every admin route stands behind.
 *
 * Re-checked on every request (a session that was staff yesterday is not staff
 * today if the allow-list changed), and it returns a bare 404 for BOTH the
 * unauthenticated and the non-staff case — a 403 would confirm the route exists
 * and that someone is on the other side of it. The service role behind these
 * routes bypasses RLS, so this check is the ONLY thing standing in front of it.
 */
export async function staffOrRefusal(): Promise<Response | StaffContext> {
  const auth = await requireUser();
  if ("response" in auth) return new Response("Not found", { status: 404 });
  if (!isStaff(auth.user.email)) {
    console.warn(`Non-staff account reached an admin route: ${auth.user.id}`);
    return new Response("Not found", { status: 404 });
  }
  return { staffId: auth.user.id, staffEmail: auth.user.email ?? null };
}

/**
 * A GET admin route in one line: wrap in handled(), gate on staff, build the
 * JSON with the service-role client, and never cache. Keeps every read route
 * identically authorized so a new section can't accidentally ship ungated.
 *
 * A builder that returns a Response (e.g. notFoundJson for a missing entity)
 * has that returned verbatim; anything else is JSON with no-store.
 */
export function adminGet(
  build: (admin: SupabaseClient, staff: StaffContext) => Promise<unknown>,
): Promise<Response> {
  return handled(async () => {
    const staff = await staffOrRefusal();
    if (staff instanceof Response) return staff;
    const payload = await build(supabaseAdmin(), staff);
    if (payload instanceof Response) return payload;
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  });
}

/** A 404 an entity route can return when the id matches nothing. */
export function notFoundJson(): Response {
  return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
