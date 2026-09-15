import "server-only";

import { createHmac } from "node:crypto";

/**
 * OneSignal's Web SDK cannot yet prove an External ID with a signed JWT.
 * Never expose the raw Supabase UUID there: host UUIDs can appear in public
 * catalogue data and somebody who knows one could otherwise attach their own
 * browser to that person's OneSignal user.
 *
 * This keyed, domain-separated alias is stable for the account but cannot be
 * calculated for anybody else by a client. A dedicated key is preferred; the
 * existing server-only Supabase secret is a safe migration fallback so push
 * does not depend on another secret being copied before first deploy.
 */
export function oneSignalExternalId(userId: string): string | null {
  const secret =
    process.env.ONESIGNAL_EXTERNAL_ID_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();

  if (!secret || secret.length < 32) return null;

  const digest = createHmac("sha256", secret)
    .update(`minimum-stress:onesignal:user:v1:${userId}`, "utf8")
    .digest("base64url");

  return `ms_${digest}`;
}
