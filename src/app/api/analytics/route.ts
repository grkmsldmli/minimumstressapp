import type { NextRequest } from "next/server";

import {
  ANALYTICS_PLATFORMS,
  APP_SURFACE,
  CLIENT_ANALYTICS_EVENTS,
  SITE_SURFACES,
  type AnalyticsPlatform,
  type ClientAnalyticsEvent,
} from "@/lib/analytics/client";
import { check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { jsonError } from "@/lib/api/session";
import { supabaseAdmin } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 1024;
const ANALYTICS_LIMIT = { limit: 120, windowMs: 60_000 };
const BODY_FIELDS = new Set(["event", "platform", "surface", "sessionId"]);
const EVENT_SET = new Set<string>(CLIENT_ANALYTICS_EVENTS);
const PLATFORM_SET = new Set<string>(ANALYTICS_PLATFORMS);
const SITE_SURFACE_SET = new Set<string>(SITE_SURFACES);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  event: ClientAnalyticsEvent;
  platform: AnalyticsPlatform;
  surface: string;
  sessionId: string;
};

type BodyResult = { ok: true; value: Body } | { ok: false; response: Response };

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Read no more than the advertised ceiling, even if Content-Length is absent or false. */
async function readBody(request: Request): Promise<BodyResult> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) {
    return { ok: false, response: noStore(jsonError("Request body is too large", 413)) };
  }

  if (!request.body) {
    return { ok: false, response: noStore(jsonError("Expected a JSON body", 400)) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, response: noStore(jsonError("Request body is too large", 413)) };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, response: noStore(jsonError("Expected a JSON body", 400)) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, response: noStore(jsonError("Expected a JSON object", 400)) };
  }

  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((key) => !BODY_FIELDS.has(key))) {
    return { ok: false, response: noStore(jsonError("Unexpected analytics field", 400)) };
  }
  if (typeof body.event !== "string" || !EVENT_SET.has(body.event)) {
    return { ok: false, response: noStore(jsonError("Unknown analytics event", 400)) };
  }
  if (typeof body.platform !== "string" || !PLATFORM_SET.has(body.platform)) {
    return { ok: false, response: noStore(jsonError("Unknown analytics platform", 400)) };
  }
  if (typeof body.surface !== "string" || typeof body.sessionId !== "string") {
    return { ok: false, response: noStore(jsonError("Invalid analytics event", 400)) };
  }
  if (!SESSION_ID.test(body.sessionId)) {
    return { ok: false, response: noStore(jsonError("Invalid analytics session", 400)) };
  }

  const platform = body.platform as AnalyticsPlatform;
  const event = body.event as ClientAnalyticsEvent;
  const validPair =
    platform === "site_web"
      ? event === "page_viewed" && SITE_SURFACE_SET.has(body.surface)
      : event === "app_opened" && body.surface === APP_SURFACE;

  if (!validPair) {
    return { ok: false, response: noStore(jsonError("Invalid analytics surface", 400)) };
  }

  return {
    ok: true,
    value: { event, platform, surface: body.surface, sessionId: body.sessionId },
  };
}

/**
 * Cookie-free, first-party analytics ingestion.
 *
 * A caller can report only two low-impact events and fixed surfaces. There is
 * no user id, persistent anonymous id, referrer, query string or properties
 * bag in the insert. The service key stays on the server and the table remains
 * closed to anon/authenticated PostgREST roles.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return noStore(jsonError("Cross-origin analytics is not allowed", 403));
  }

  const limited = check("analytics", identify(request), ANALYTICS_LIMIT);
  if (!limited.ok) return tooManyRequests(limited);

  const body = await readBody(request);
  if (!body.ok) return body.response;

  try {
    const { error } = await supabaseAdmin().from("analytics_events").insert({
      event_name: body.value.event,
      user_id: null,
      anonymous_id: null,
      session_id: body.value.sessionId,
      platform: body.value.platform,
      app_version: null,
      surface: body.value.surface,
      properties: {},
    });
    if (error) {
      console.error(`analytics: insert failed: ${error.message}`);
      return noStore(jsonError("Analytics is unavailable right now", 503));
    }
  } catch (cause) {
    console.error("analytics: insert threw", cause);
    return noStore(jsonError("Analytics is unavailable right now", 503));
  }

  return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
}
