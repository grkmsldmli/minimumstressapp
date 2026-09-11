import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { listOpportunities } from "@/lib/work-service";

/**
 * The coverage a practitioner has been matched to, plus anything they have
 * already engaged with. Matching runs server-side on the admin client, so the
 * marketplace's whole open list never reaches the browser — only the safe
 * previews of requests this practitioner genuinely fits.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const limited = check("workRead", identify(request, auth.user.id), LIMITS.workRead);
    if (!limited.ok) return tooManyRequests(limited);

    const opportunities = await listOpportunities(supabaseAdmin(), auth.user.id);

    return Response.json(
      { opportunities },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
