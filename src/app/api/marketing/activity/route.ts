import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { jsonError, requireUser } from "@/lib/api/session";
import { hasMarketingConsent } from "@/lib/marketing/lifecycle";
import { supabaseAdmin } from "@/lib/supabase/server";

const EVENTS = new Set(["app_opened", "space_browsed"]);
const MAX_BODY_BYTES = 128;

/**
 * Coarse activity used only after explicit marketing opt-in.
 *
 * No space id, route, query, location or device identifier is accepted. An
 * opt-out stops future writes immediately and the outbox rechecks it again at
 * claim and send time.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const limited = check(
    "marketing-activity",
    identify(request, auth.user.id),
    LIMITS.marketingActivity,
  );
  if (!limited.ok) return tooManyRequests(limited);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return jsonError("Request body is too large", 413);
  }
  const body = await readBoundedJsonObject(request);
  if (body === "too_large") return jsonError("Request body is too large", 413);
  if (
    !body ||
    Object.keys(body).length !== 1 ||
    typeof body.event !== "string" ||
    !EVENTS.has(body.event)
  ) {
    return jsonError("Invalid marketing activity", 400);
  }

  const { data: preference, error: preferenceError } = await auth.db
    .from("profiles")
    .select("notify_offers, marketing_consent_at, marketing_unsubscribed_at")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (preferenceError) return jsonError("Marketing preferences are unavailable", 503);

  const consented = preference && hasMarketingConsent({
    notifyOffers: preference.notify_offers === true,
    consentAt: preference.marketing_consent_at
      ? new Date(preference.marketing_consent_at as string)
      : null,
    unsubscribedAt: preference.marketing_unsubscribed_at
      ? new Date(preference.marketing_unsubscribed_at as string)
      : null,
  });
  if (!consented) return new Response(null, { status: 204 });

  const now = new Date().toISOString();
  const timestampColumn = body.event === "app_opened"
    ? "last_app_opened_at"
    : "last_space_browsed_at";
  const { error } = await supabaseAdmin().from("marketing_activity").upsert(
    {
      user_id: auth.user.id,
      [timestampColumn]: now,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (error) return jsonError("Marketing activity is unavailable", 503);
  return new Response(null, { status: 204 });
}

async function readBoundedJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null | "too_large"> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
