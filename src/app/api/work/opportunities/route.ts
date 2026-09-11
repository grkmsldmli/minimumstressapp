import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, requireUser } from "@/lib/api/session";
import type { BoardFilters } from "@/lib/domain";
import { supabaseAdmin } from "@/lib/supabase/server";
import { listOpportunities } from "@/lib/work-service";

/**
 * The coverage job board: every open, future request, browseable by a Pro
 * practitioner. There is no matching and no algorithmic exclusion — the query
 * params are filters the practitioner chose, which only narrow the browse.
 *
 * The browse is Pro-gated inside listOpportunities (canBrowseWork), server-side:
 * a free or lapsed practitioner gets only their own existing applications back,
 * never the open board, so they can still manage what they committed to while the
 * client shows the Pro upsell in place of the board. Only safe previews ever
 * leave the server (area not street, no host id, coarse distance).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("workRead", identify(request, auth.user.id), LIMITS.workRead);
    if (!limited.ok) return tooManyRequests(limited);

    const admin = supabaseAdmin();

    const q = request.nextUrl.searchParams;
    const parseDate = (raw: string | null): Date | null => {
      if (!raw) return null;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const parseInt = (raw: string | null): number | null => {
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(n) : null;
    };
    const filters: BoardFilters = {
      profession: q.get("profession"),
      sessionFormat: q.get("sessionFormat"),
      level: q.get("level"),
      minPayCents: parseInt(q.get("minPayCents")),
      urgentOnly: q.get("urgentOnly") === "true",
      onOrAfter: parseDate(q.get("onOrAfter")),
      onOrBefore: parseDate(q.get("onOrBefore")),
    };

    const opportunities = await listOpportunities(admin, auth.user.id, filters);

    return Response.json(
      { opportunities },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
