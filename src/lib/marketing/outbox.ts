import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { APP_URL } from "../company";
import { supabaseAdmin } from "../supabase/server";
import { sendMarketingEmail } from "../notify/transports";
import {
  type MarketingFacts,
  type MarketingLifecycle,
  hasMarketingConsent,
  marketingLifecycleBucket,
  marketingLifecycleCandidates,
  orderMarketingLifecycles,
} from "./lifecycle";
import { MARKETING_TEMPLATE_VERSION, renderMarketingEmail } from "./templates";

const PROFILE_PAGE = 500;
const MAX_ATTEMPTS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProfileRow = {
  id: string;
  account_type: "host" | "practitioner" | null;
  created_at: string;
  updated_at: string;
  profession: string | null;
  search_postcode: string | null;
  terms_accepted_at: string | null;
  notify_offers: boolean;
  marketing_consent_at: string | null;
  marketing_unsubscribed_at: string | null;
  marketing_unsubscribe_token: string;
};

type SpaceRow = {
  host_id: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  creation_completed_at: string | null;
};

type BookingRow = {
  id: string;
  practitioner_id: string;
  ends_at: string;
  created_at: string;
  spaces?: { host_id?: string } | Array<{ host_id?: string }> | null;
};

type ActivityRow = {
  user_id: string;
  last_app_opened_at: string | null;
  last_space_browsed_at: string | null;
};

type ClaimedMarketingEmail = {
  id: string;
  user_id: string;
  campaign: MarketingLifecycle;
  dedupe_key: string;
  subject: string;
  text_body: string;
  html_body: string;
  provider_correlation_id: string;
  attempts: number;
  lease_token: string;
  unsubscribe_token: string;
};

export interface MarketingEnqueueResult {
  configured: boolean;
  profilesScanned: number;
  profilesEligible: number;
  enqueued: number;
}

export interface MarketingProcessResult {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  suppressed: number;
}

/** Commercial mail cannot be sent lawfully without a real physical address. */
export function marketingPostalAddress(): string | null {
  const value = process.env.MARKETING_POSTAL_ADDRESS?.trim() ?? "";
  return value && value.length <= 300 && !/[\u0000-\u001F\u007F]/.test(value)
    ? value
    : null;
}

/**
 * Evaluate opted-in profiles and atomically offer their eligible journeys to
 * Postgres. The RPC owns dedupe and caps, so overlapping daily crons are safe.
 */
export async function enqueueMarketingLifecycles(
  admin: SupabaseClient = supabaseAdmin(),
  now = new Date(),
): Promise<MarketingEnqueueResult> {
  const postalAddress = marketingPostalAddress();
  if (!postalAddress) {
    return { configured: false, profilesScanned: 0, profilesEligible: 0, enqueued: 0 };
  }

  let profilesScanned = 0;
  let profilesEligible = 0;
  let enqueued = 0;

  for (let offset = 0; ; offset += PROFILE_PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select(
        "id, account_type, created_at, updated_at, profession, search_postcode, terms_accepted_at, notify_offers, marketing_consent_at, marketing_unsubscribed_at, marketing_unsubscribe_token",
      )
      .eq("notify_offers", true)
      .not("marketing_consent_at", "is", null)
      .is("marketing_unsubscribed_at", null)
      .order("id")
      .range(offset, offset + PROFILE_PAGE - 1);
    if (error) throw new Error("Could not read marketing-consented profiles");

    const profiles = (data ?? []) as ProfileRow[];
    if (!profiles.length) break;
    profilesScanned += profiles.length;

    const facts = await lifecycleFactsForProfiles(admin, profiles, now);
    for (const profile of profiles) {
      const profileFacts = facts.get(profile.id);
      if (!profileFacts || !hasMarketingConsent({
        notifyOffers: profile.notify_offers,
        consentAt: dateOrNull(profile.marketing_consent_at),
        unsubscribedAt: dateOrNull(profile.marketing_unsubscribed_at),
      })) continue;

      const candidates = orderMarketingLifecycles(
        marketingLifecycleCandidates(profileFacts, now),
      );
      if (!candidates.length) continue;
      profilesEligible += 1;

      for (const campaign of candidates) {
        const snapshot = renderMarketingEmail(
          campaign,
          profile.marketing_unsubscribe_token,
          postalAddress,
        );
        const dedupeKey = marketingDedupeKey(profile.id, campaign, profileFacts, now);
        const correlationId = createHash("sha256").update(dedupeKey, "utf8").digest("hex");
        const { data: inserted, error: enqueueError } = await admin.rpc(
          "enqueue_marketing_email",
          {
            p_user_id: profile.id,
            p_campaign: campaign,
            p_campaign_version: MARKETING_TEMPLATE_VERSION,
            p_dedupe_key: dedupeKey,
            p_subject: snapshot.subject,
            p_text_body: snapshot.text,
            p_html_body: snapshot.html,
            p_provider_correlation_id: correlationId,
            p_send_after: now.toISOString(),
            p_expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
            p_now: now.toISOString(),
          },
        );
        if (enqueueError) throw new Error("Could not enqueue marketing lifecycle email");
        if (inserted === true) {
          enqueued += 1;
          break;
        }
      }
    }

    if (profiles.length < PROFILE_PAGE) break;
  }

  return { configured: true, profilesScanned, profilesEligible, enqueued };
}

/** Claim and deliver immutable marketing envelopes with a final consent check. */
export async function processMarketingOutbox(
  admin: SupabaseClient = supabaseAdmin(),
  options: { now?: Date; limit?: number } = {},
): Promise<MarketingProcessResult> {
  const now = options.now ?? new Date();
  const worker = randomUUID();
  const { data, error } = await admin.rpc("claim_marketing_email_batch", {
    p_worker: worker,
    p_limit: options.limit ?? 20,
    p_now: now.toISOString(),
  });
  if (error) throw new Error("Could not claim marketing email batch");

  const rows = (data ?? []) as ClaimedMarketingEmail[];
  const result: MarketingProcessResult = {
    claimed: rows.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    suppressed: 0,
  };
  let cursor = 0;

  const work = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        const consent = await currentConsent(admin, row.user_id);
        if (!consent) {
          await closeRow(admin, row, "suppressed", "marketing consent withdrawn", now);
          result.suppressed += 1;
          continue;
        }

        const { data: userResult, error: userError } = await admin.auth.admin.getUserById(
          row.user_id,
        );
        const user = userResult?.user;
        if (userError) throw new Error("recipient lookup unavailable");
        if (!user?.email || !user.email_confirmed_at) {
          await closeRow(admin, row, "suppressed", "recipient has no confirmed email", now);
          result.suppressed += 1;
          continue;
        }

        if (
          !row.subject || !row.text_body || !row.html_body ||
          !UUID.test(row.unsubscribe_token)
        ) {
          await closeRow(admin, row, "failed", "marketing envelope is invalid", now);
          result.failed += 1;
          continue;
        }

        const unsubscribeUrl = new URL(
          `/api/marketing/unsubscribe?token=${encodeURIComponent(row.unsubscribe_token)}`,
          APP_URL,
        ).href;
        const delivered = await sendMarketingEmail(
          user.email,
          {
            subject: row.subject,
            text: row.text_body,
            html: row.html_body,
            unsubscribeUrl,
          },
          {
            idempotencyKey: marketingProviderIdempotencyKey(row.dedupe_key),
            correlationId: row.provider_correlation_id,
          },
        );

        if (delivered.status === "sent") {
          const { error: acceptanceError } = await admin.rpc(
            "record_marketing_email_acceptance",
            {
              p_id: row.id,
              p_provider_message_id: delivered.id,
              p_accepted_at: new Date().toISOString(),
              p_lease_token: row.lease_token,
            },
          );
          if (acceptanceError) throw new Error("Could not record marketing provider acceptance");
          result.sent += 1;
        } else if (delivered.status === "retry") {
          const outcome = await retryRow(admin, row, delivered.reason, now);
          result[outcome] += 1;
        } else if (delivered.status === "skipped") {
          await closeRow(admin, row, "suppressed", delivered.reason, now);
          result.suppressed += 1;
        } else {
          await closeRow(admin, row, "failed", delivered.reason, now);
          result.failed += 1;
        }
      } catch {
        const outcome = await retryRow(
          admin,
          row,
          "marketing delivery temporarily unavailable",
          now,
        );
        result[outcome] += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, () => work()));
  return result;
}

export function marketingDedupeKey(
  userId: string,
  campaign: MarketingLifecycle,
  facts: MarketingFacts,
  now: Date,
): string {
  return `marketing:v${MARKETING_TEMPLATE_VERSION}:${campaign}:${userId}:${marketingLifecycleBucket(campaign, facts, now)}`;
}

export function marketingProviderIdempotencyKey(dedupeKey: string): string {
  const digest = createHash("sha256").update(dedupeKey, "utf8").digest("hex");
  return `minimum-stress-marketing-${digest}`;
}

async function lifecycleFactsForProfiles(
  admin: SupabaseClient,
  profiles: ProfileRow[],
  now: Date,
): Promise<Map<string, MarketingFacts>> {
  const ids = profiles.map((profile) => profile.id);
  const [spacesResult, practitionerResult, hostResult, activityResult] = await Promise.all([
    admin
      .from("spaces")
      .select("host_id, status, created_at, updated_at, creation_completed_at")
      .in("host_id", ids),
    admin
      .from("bookings")
      .select("id, practitioner_id, ends_at, created_at")
      .in("practitioner_id", ids)
      .not("captured_at", "is", null)
      .in("status", ["upcoming", "completed", "no_show"]),
    admin
      .from("bookings")
      .select("id, practitioner_id, ends_at, created_at, spaces!inner(host_id)")
      .in("spaces.host_id", ids)
      .not("captured_at", "is", null)
      .in("status", ["upcoming", "completed", "no_show"]),
    admin
      .from("marketing_activity")
      .select("user_id, last_app_opened_at, last_space_browsed_at")
      .in("user_id", ids),
  ]);
  if (spacesResult.error || practitionerResult.error || hostResult.error || activityResult.error) {
    throw new Error("Could not assemble marketing lifecycle facts");
  }

  return marketingFactsFor(
    profiles,
    (spacesResult.data ?? []) as SpaceRow[],
    (practitionerResult.data ?? []) as BookingRow[],
    (hostResult.data ?? []) as BookingRow[],
    (activityResult.data ?? []) as ActivityRow[],
    now,
  );
}

export function marketingFactsFor(
  profiles: ProfileRow[],
  spaces: SpaceRow[],
  practitionerBookings: BookingRow[],
  hostBookings: BookingRow[],
  activities: ActivityRow[],
  now: Date,
): Map<string, MarketingFacts> {
  const spacesByHost = groupBy(spaces, (space) => space.host_id);
  const practitionerByUser = groupBy(practitionerBookings, (booking) => booking.practitioner_id);
  const hostByUser = new Map<string, BookingRow[]>();
  for (const booking of hostBookings) {
    const relation = Array.isArray(booking.spaces) ? booking.spaces[0] : booking.spaces;
    const hostId = relation?.host_id;
    if (!hostId) continue;
    hostByUser.set(hostId, [...(hostByUser.get(hostId) ?? []), booking]);
  }
  const activityByUser = new Map(activities.map((activity) => [activity.user_id, activity]));
  const result = new Map<string, MarketingFacts>();

  for (const profile of profiles) {
    const isHost = profile.account_type === "host";
    const ownedSpaces = spacesByHost.get(profile.id) ?? [];
    const liveSpaces = ownedSpaces.filter((space) => space.status === "active");
    const bookings = isHost
      ? dedupeBookings(hostByUser.get(profile.id) ?? [])
      : dedupeBookings(practitionerByUser.get(profile.id) ?? []);
    const activity = activityByUser.get(profile.id);
    const lastBookingAt = maxDate(bookings.map((booking) => booking.ends_at));
    const accountCreatedAt = safeDate(profile.created_at, now);
    const profileUpdatedAt = safeDate(profile.updated_at, accountCreatedAt);
    const lastAppOpenedAt = dateOrNull(activity?.last_app_opened_at ?? null);

    result.set(profile.id, {
      accountCreatedAt,
      onboardingComplete: isHost
        ? profile.account_type === "host" && ownedSpaces.some((space) => space.creation_completed_at)
        : profile.account_type === "practitioner" && Boolean(
            profile.profession && profile.search_postcode && profile.terms_accepted_at
          ),
      isHost,
      liveListings: liveSpaces.length,
      firstLiveListingAt: minDate(
        liveSpaces.map((space) => space.creation_completed_at ?? space.created_at),
      ),
      bookingCount: bookings.length,
      lastBrowseAt: dateOrNull(activity?.last_space_browsed_at ?? null),
      lastBookingAt,
      lastActiveAt: latestDate(
        [profileUpdatedAt, lastAppOpenedAt, lastBookingAt],
        profileUpdatedAt,
      ),
    });
  }

  return result;
}

async function currentConsent(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("notify_offers, marketing_consent_at, marketing_unsubscribed_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not recheck marketing consent");
  return Boolean(data && hasMarketingConsent({
    notifyOffers: data.notify_offers === true,
    consentAt: dateOrNull(data.marketing_consent_at as string | null),
    unsubscribedAt: dateOrNull(data.marketing_unsubscribed_at as string | null),
  }));
}

async function retryRow(
  admin: SupabaseClient,
  row: ClaimedMarketingEmail,
  reason: string,
  now: Date,
): Promise<"retrying" | "failed"> {
  if (row.attempts >= MAX_ATTEMPTS) {
    await closeRow(admin, row, "failed", "marketing retry attempts exhausted", now);
    return "failed";
  }
  const minutes = Math.min(6 * 60, 2 ** Math.max(0, row.attempts - 1));
  const { error } = await admin
    .from("marketing_outbox")
    .update({
      state: "queued",
      provider_status: "queued",
      next_attempt_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
      last_error: reason,
      lease_token: null,
      lease_until: null,
      updated_at: now.toISOString(),
    })
    .eq("id", row.id)
    .eq("lease_token", row.lease_token);
  if (error) throw new Error("Could not release marketing retry");
  return "retrying";
}

async function closeRow(
  admin: SupabaseClient,
  row: ClaimedMarketingEmail,
  state: "failed" | "suppressed",
  reason: string,
  now: Date,
): Promise<void> {
  const { error } = await admin
    .from("marketing_outbox")
    .update({
      state,
      provider_status: state,
      subject: null,
      text_body: null,
      html_body: null,
      ...(state === "failed"
        ? { failed_at: now.toISOString() }
        : { suppressed_at: now.toISOString() }),
      last_error: reason,
      lease_token: null,
      lease_until: null,
      updated_at: now.toISOString(),
    })
    .eq("id", row.id)
    .eq("lease_token", row.lease_token);
  if (error) throw new Error("Could not close marketing email");
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

function dedupeBookings(rows: BookingRow[]): BookingRow[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeDate(value: string, fallback: Date): Date {
  return dateOrNull(value) ?? fallback;
}

function maxDate(values: Array<string | null | undefined>): Date | null {
  const dates = values.map(dateOrNull).filter((value): value is Date => value !== null);
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}

function minDate(values: Array<string | null | undefined>): Date | null {
  const dates = values.map(dateOrNull).filter((value): value is Date => value !== null);
  return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
}

function latestDate(values: Array<Date | null>, fallback: Date): Date {
  const dates = values.filter((value): value is Date => value !== null);
  return dates.length
    ? new Date(Math.max(...dates.map((date) => date.getTime())))
    : fallback;
}
