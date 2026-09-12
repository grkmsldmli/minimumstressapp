import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type AnalyticsEventInput, validateEvent } from "./events";

/**
 * Record one analytics event, server-side, best-effort.
 *
 * Never throws into the caller: an analytics hiccup must never break the payment,
 * booking, or subscription flow it rides alongside. Server emitters pass
 * `allowServerOnly` (the default here) so they may write the business-fact events
 * the public ingestion route forbids. Writes go through the service-role client.
 */
export async function recordEvent(
  admin: SupabaseClient,
  input: AnalyticsEventInput,
  allowServerOnly = true,
): Promise<void> {
  const v = validateEvent(input, allowServerOnly);
  if (!v.ok) {
    console.warn(`analytics: dropped event "${input.name}" — ${v.reason}`);
    return;
  }
  try {
    const { error } = await admin.from("analytics_events").insert({
      event_name: v.value.name,
      user_id: v.value.userId,
      anonymous_id: v.value.anonymousId,
      session_id: v.value.sessionId,
      platform: v.value.platform,
      app_version: v.value.appVersion,
      surface: v.value.surface,
      properties: v.value.properties,
    });
    if (error) console.error(`analytics: insert failed for "${v.value.name}": ${error.message}`);
  } catch (cause) {
    console.error("analytics: insert threw", cause);
  }
}
