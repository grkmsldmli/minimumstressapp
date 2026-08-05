import type { NextRequest } from "next/server";

import { isStaff } from "@/lib/admin/access";
import { handled, jsonError, requireUser } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * A short-lived link to one verification document.
 *
 * Approving a listing means reading somebody's lease, so staff have to be able
 * to open it — and the file sits in a private bucket no client key can reach.
 * This mints a signed URL, which is a bearer token: anybody holding it can
 * fetch the file, allowlist or not.
 *
 * So it expires in two minutes. Long enough to open a PDF, short enough that a
 * URL left in a history, a chat message or a screenshot is worthless by the
 * time anybody finds it.
 */
const LINK_LIFETIME_SECONDS = 120;

export async function GET(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return new Response("Not found", { status: 404 });
    if (!isStaff(auth.user.email)) return new Response("Not found", { status: 404 });

    const path = request.nextUrl.searchParams.get("path");
    if (!path) return jsonError("path is required", 400);

    /**
     * Constrained to the bucket's own two prefixes.
     *
     * Without this the parameter is "sign me anything in this bucket", and a
     * bucket is not the only thing a path can reach — `..` segments and
     * absolute-looking paths are exactly what storage layers disagree about.
     * Staff are trusted; a staff session that has been taken is not.
     */
    if (!/^(space|practitioner)\/[0-9a-f-]{36}\/[\w.-]+$/i.test(path)) {
      return jsonError("That is not a verification document path", 400);
    }

    const { data, error } = await supabaseAdmin()
      .storage.from("verification-docs")
      .createSignedUrl(path, LINK_LIFETIME_SECONDS);

    if (error || !data) {
      console.error(`Could not sign ${path}:`, error);
      return jsonError("Could not open that document", 404);
    }

    return Response.json(
      { url: data.signedUrl, expiresInSeconds: LINK_LIFETIME_SECONDS },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
