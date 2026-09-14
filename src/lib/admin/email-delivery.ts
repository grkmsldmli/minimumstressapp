import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ResendDeliveryEventType } from "@/lib/resend/webhook";

export interface EmailDeliveryEvidence {
  available: boolean;
  checkedAt: string;
  lastEventAt: string | null;
  lastEventType: ResendDeliveryEventType | null;
}

const DEFAULT_FROM = "Minimum Stress <hello@minimumstress.app>";

/**
 * Bind delivery proof to the exact sender configuration that produced it.
 * The inputs are high-entropy secrets; only their one-way digest is stored.
 */
export function emailDeliveryConfigurationFingerprint(): string | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!apiKey || !webhookSecret?.startsWith("whsec_")) return null;

  const from = process.env.NOTIFY_FROM_EMAIL?.trim() || DEFAULT_FROM;
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, apiKey, webhookSecret, from }), "utf8")
    .digest("hex");
}

/** Record the provider id of a real Command Center delivery probe. */
export async function recordEmailDeliveryProbe(
  admin: SupabaseClient,
  resendEmailId: string,
): Promise<boolean> {
  const fingerprint = emailDeliveryConfigurationFingerprint();
  if (
    !fingerprint ||
    !resendEmailId ||
    resendEmailId === "unknown" ||
    resendEmailId.length > 200
  ) return false;

  const { error } = await admin.from("resend_email_probes").insert({
    resend_email_id: resendEmailId,
    configuration_sha256: fingerprint,
  });

  if (!error || error.code === "23505") return true;
  console.error("Email delivery probe could not be recorded");
  return false;
}

/**
 * Read the newest provider-authenticated delivery fact.
 *
 * Provider time, not receipt time, decides which fact is newest because Resend
 * may retry or deliver webhooks out of order. Query failure stays explicit so
 * Command Center never turns a missing migration or database outage green.
 */
export async function loadEmailDeliveryEvidence(
  admin: SupabaseClient,
): Promise<EmailDeliveryEvidence> {
  const checkedAt = new Date().toISOString();
  const fingerprint = emailDeliveryConfigurationFingerprint();
  if (!fingerprint) {
    return { available: false, checkedAt, lastEventAt: null, lastEventType: null };
  }

  const { data: probes, error: probeError } = await admin
    .from("resend_email_probes")
    .select("resend_email_id")
    .eq("configuration_sha256", fingerprint)
    .order("accepted_at", { ascending: false })
    .order("resend_email_id", { ascending: false })
    .limit(1);

  if (probeError) return unavailable(checkedAt);
  const probe = (probes as Array<{ resend_email_id: string }> | null)?.[0];
  if (!probe) {
    return { available: true, checkedAt, lastEventAt: null, lastEventType: null };
  }

  const { data, error } = await admin
    .from("resend_email_events")
    .select("event_type, event_created_at")
    .eq("resend_email_id", probe.resend_email_id)
    .order("event_created_at", { ascending: false })
    .order("received_at", { ascending: false })
    .limit(1);

  if (error) return unavailable(checkedAt);

  const row = (data as Array<{
    event_type: ResendDeliveryEventType;
    event_created_at: string;
  }> | null)?.[0];

  return {
    available: true,
    checkedAt,
    lastEventAt: row?.event_created_at ?? null,
    lastEventType: row?.event_type ?? null,
  };
}

function unavailable(checkedAt: string): EmailDeliveryEvidence {
  console.error("Email delivery evidence query failed");
  return { available: false, checkedAt, lastEventAt: null, lastEventType: null };
}
