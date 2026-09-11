import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BoardFilters,
  CoverageRequestInput,
  RequestInterest,
  RosterMember,
  WorkInterestState,
  WorkOpportunity,
  WorkRequestState,
} from "./domain";
import { distanceBetween, distanceLabel } from "./distance";
import { type EntitlementFacts, entitlementsFor } from "./entitlements";
import type { LatLng } from "./geo";
import type { InsuranceFacts } from "./insurance";
import { workEligibility } from "./work/eligibility";
import {
  notifyWorkConfirmed,
  notifyWorkInterestReceived,
  notifyWorkOpportunity,
  notifyWorkRequestCancelled,
  notifyWorkSelectionWithdrawn,
  type WorkNotifyContext,
} from "./notify/for-work";
import { professionLabel } from "./professions";
import { standingFor, toCancellationEvents } from "./reliability";
import { FALLBACK_ZONE, isKnownZone } from "./timezone";
import type { CandidateFacts } from "./work/matching";
import { acceptsInterest, effectiveRequestState } from "./work/request-state";
import { sessionDetailsFromRow, sessionDetailsToRow } from "./work/session-details";

/**
 * The server half of Work: the coverage board read, notification, and the
 * mutations that must outrank the signed-in user (posting, confirming
 * atomically, cancelling). All of it runs on the admin client passed in — so,
 * like every admin-path write, ownership and entitlement are re-checked in code
 * here, not left to a policy the admin bypasses.
 *
 * The board is browse-all: every open, future request is visible to any Pro
 * practitioner. Matching no longer decides visibility — filters narrow the
 * browse, and the practitioner decides whether to apply. Entitlement is the pure
 * function in lib/entitlements over server-written columns, and the only thing
 * that ever leaves the server is a coarse, safe preview (area not street, a
 * masked name, a distance label, the trust booleans).
 */

export type WorkFailure =
  | "not_a_host"
  | "not_a_practitioner"
  | "space_required"
  | "space_not_yours"
  | "template_not_yours"
  | "request_not_found"
  | "request_not_open"
  | "request_not_yours"
  | "not_matchable"
  | "not_entitled"
  | "not_eligible"
  | "already_decided"
  | "interest_not_found"
  | "interest_not_yours"
  | "already_filled"
  | "no_relationship"
  | "practitioner_unavailable"
  | "invalid_time";

export type WorkResult<T> = { ok: true; value: T } | { ok: false; reason: WorkFailure };

/** Human wording + HTTP status for each failure. Not-found and not-yours share
 *  wording so an id cannot be probed. */
export function explainWorkFailure(reason: WorkFailure): { message: string; status: number } {
  switch (reason) {
    case "not_a_host":
      return { message: "Only a studio can post coverage.", status: 403 };
    case "not_a_practitioner":
      return { message: "Only a practitioner can do that.", status: 403 };
    case "space_required":
      return { message: "Choose which space needs coverage.", status: 400 };
    case "space_not_yours":
    case "template_not_yours":
    case "request_not_found":
    case "request_not_yours":
    case "interest_not_found":
    case "interest_not_yours":
      return { message: "We couldn't find that.", status: 404 };
    case "request_not_open":
      return { message: "This request is no longer open.", status: 409 };
    case "not_matchable":
      return { message: "This coverage isn't a match for your profile.", status: 409 };
    case "not_entitled":
      return { message: "This needs an active subscription.", status: 403 };
    case "not_eligible":
      return {
        message: "Finish your professional profile before applying.",
        status: 403,
      };
    case "already_decided":
      return { message: "This has already been decided.", status: 409 };
    case "already_filled":
      return { message: "This request was just filled. Nothing was changed.", status: 409 };
    case "no_relationship":
      return {
        message: "You can add someone to your roster once you've confirmed them for a class.",
        status: 409,
      };
    case "practitioner_unavailable":
      return { message: "That professional isn't available to invite right now.", status: 409 };
    case "invalid_time":
      return { message: "Choose a time in the future.", status: 400 };
  }
}

const MINUTE_MS = 60_000;

/**
 * The entitlement of the calling account, from server-written columns only —
 * the same discipline as the booking gate. Every Work mutation re-checks this,
 * so a UI paywall can never be the only gate.
 */
export async function loadEntitlements(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<ReturnType<typeof entitlementsFor>> {
  const { data: p } = await admin
    .from("profiles")
    .select(
      "account_type, is_pro, studio_pro, founding_host_at, profession, identity_verified_at, insurance_doc_path, insurance_doc_state, insurance_effective_date, insurance_expires_at, credential_doc_state",
    )
    .eq("id", userId)
    .maybeSingle();

  const { data: bookings } = await admin
    .from("bookings")
    .select("cancelled_by, captured_at, cancelled_at, starts_at")
    .eq("practitioner_id", userId);
  const cancellations = toCancellationEvents(
    (bookings ?? []).map((b) => ({
      cancelledBy: (b.cancelled_by as string | null) ?? null,
      capturedAt: (b.captured_at as string | null) ?? null,
      cancelledAt: (b.cancelled_at as string | null) ?? null,
      sessionStart: b.starts_at as string,
    })),
  );

  const facts: EntitlementFacts = {
    accountType: (p?.account_type as "practitioner" | "host" | null) ?? null,
    isPro: Boolean(p?.is_pro),
    studioProSubscription: Boolean(p?.studio_pro),
    foundingHostAt: p?.founding_host_at ? new Date(p.founding_host_at as string) : null,
    work: workEligibility(
      {
        accountType: (p?.account_type as "practitioner" | "host" | null) ?? null,
        profession: (p?.profession as string | null) ?? null,
        identityVerified: Boolean(p?.identity_verified_at),
        credentialVerified: p?.credential_doc_state === "verified",
        insurance: insuranceFactsFrom({
          insurance_doc_path: (p?.insurance_doc_path as string | null) ?? null,
          insurance_doc_state: (p?.insurance_doc_state as string | null) ?? null,
          insurance_effective_date: (p?.insurance_effective_date as string | null) ?? null,
          insurance_expires_at: (p?.insurance_expires_at as string | null) ?? null,
        }),
        cancellations,
      },
      now,
    ),
    now,
  };
  return entitlementsFor(facts);
}

/* ------------------------------------------------------------------ */
/*  Loading practitioner facts                                         */
/* ------------------------------------------------------------------ */

interface CandidatePreview {
  displayName: string | null;
  avatarPath: string | null;
  foundingPractitioner: boolean;
  identityVerified: boolean;
  insuranceVerified: boolean;
  credentialReviewed: boolean;
  completedSessions: number;
  goodStanding: boolean;
}

interface LoadedCandidate {
  facts: CandidateFacts;
  preview: CandidatePreview;
}

function insuranceFactsFrom(row: {
  insurance_doc_path: string | null;
  insurance_doc_state: string | null;
  insurance_effective_date: string | null;
  insurance_expires_at: string | null;
}): InsuranceFacts {
  const state = row.insurance_doc_state === "verified" || row.insurance_doc_state === "rejected"
    ? row.insurance_doc_state
    : "pending";
  return {
    hasCertificate: Boolean(row.insurance_doc_path),
    state,
    effectiveDate: row.insurance_effective_date ? new Date(row.insurance_effective_date) : null,
    expiresAt: row.insurance_expires_at ? new Date(row.insurance_expires_at) : null,
  };
}

/**
 * Build full candidate facts for a set of practitioners in bulk — one query per
 * table, grouped in memory — so matching a whole request never fans out into a
 * query per person.
 */
async function loadCandidates(
  admin: SupabaseClient,
  practitionerIds: string[],
  now: Date,
): Promise<Map<string, LoadedCandidate>> {
  const out = new Map<string, LoadedCandidate>();
  if (practitionerIds.length === 0) return out;

  const [{ data: profiles }, { data: prefs }, { data: blocks }, { data: bookings }] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, account_type, profession, display_name, avatar_path, identity_verified_at, insurance_doc_path, insurance_doc_state, insurance_effective_date, insurance_expires_at, credential_doc_state, founding_practitioner_number",
        )
        .in("id", practitionerIds),
      admin
        .from("work_preferences")
        .select(
          "practitioner_id, available_for_work, work_timezone, base_lat, base_lng, max_travel_miles, min_pay_cents",
        )
        .in("practitioner_id", practitionerIds),
      admin
        .from("work_availability")
        .select("practitioner_id, weekday, start_minute, end_minute")
        .in("practitioner_id", practitionerIds),
      admin
        .from("bookings")
        .select("practitioner_id, status, cancelled_by, captured_at, cancelled_at, starts_at")
        .in("practitioner_id", practitionerIds),
    ]);

  const prefById = new Map((prefs ?? []).map((p) => [p.practitioner_id as string, p]));
  const blocksById = new Map<string, { weekday: number; startMinute: number; endMinute: number }[]>();
  for (const b of blocks ?? []) {
    const list = blocksById.get(b.practitioner_id as string) ?? [];
    list.push({ weekday: b.weekday as number, startMinute: b.start_minute as number, endMinute: b.end_minute as number });
    blocksById.set(b.practitioner_id as string, list);
  }
  const bookingsById = new Map<string, typeof bookings>();
  for (const bk of bookings ?? []) {
    const list = bookingsById.get(bk.practitioner_id as string) ?? [];
    list.push(bk);
    bookingsById.set(bk.practitioner_id as string, list);
  }

  for (const p of profiles ?? []) {
    const id = p.id as string;
    const pref = prefById.get(id);
    const myBookings = bookingsById.get(id) ?? [];
    const completedSessions = myBookings.filter((b) => b.status === "completed").length;
    const cancellations = toCancellationEvents(
      myBookings.map((b) => ({
        cancelledBy: (b.cancelled_by as string | null) ?? null,
        capturedAt: (b.captured_at as string | null) ?? null,
        cancelledAt: (b.cancelled_at as string | null) ?? null,
        sessionStart: b.starts_at as string,
      })),
    );
    const goodStanding = standingFor("practitioner", cancellations, now).level === "clear";
    const insurance = insuranceFactsFrom(p);
    const base: LatLng | null =
      pref?.base_lat != null && pref?.base_lng != null
        ? { lat: pref.base_lat as number, lng: pref.base_lng as number }
        : null;

    out.set(id, {
      facts: {
        practitionerId: id,
        availableForWork: Boolean(pref?.available_for_work),
        profession: (p.profession as string | null) ?? null,
        workZone: (pref?.work_timezone as string | null) ?? FALLBACK_ZONE,
        availability: blocksById.get(id) ?? [],
        base,
        maxTravelMiles: (pref?.max_travel_miles as number | null) ?? null,
        minPayCents: (pref?.min_pay_cents as number | null) ?? null,
        completedSessions,
        goodStanding,
        eligibility: {
          accountType: (p.account_type as "practitioner" | "host" | null) ?? null,
          profession: (p.profession as string | null) ?? null,
          identityVerified: Boolean(p.identity_verified_at),
          credentialVerified: p.credential_doc_state === "verified",
          insurance,
          cancellations,
        },
      },
      preview: {
        displayName: (p.display_name as string | null) ?? null,
        avatarPath: (p.avatar_path as string | null) ?? null,
        foundingPractitioner: p.founding_practitioner_number != null,
        identityVerified: Boolean(p.identity_verified_at),
        insuranceVerified: p.insurance_doc_state === "verified",
        credentialReviewed: p.credential_doc_state === "verified",
        completedSessions,
        goodStanding,
      },
    });
  }

  return out;
}

interface RequestRow {
  id: string;
  host_id: string;
  class_template_id: string | null;
  space_id: string | null;
  title: string;
  profession: string | null;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  pay_cents: number;
  notes: string | null;
  urgent: boolean;
  state: WorkRequestState;
  created_at: string;
}

interface SpaceRow {
  id: string;
  host_id: string;
  name: string;
  timezone: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  state: string | null;
}

async function loadSpaces(admin: SupabaseClient, spaceIds: string[]): Promise<Map<string, SpaceRow>> {
  const ids = [...new Set(spaceIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await admin
    .from("spaces")
    .select("id, host_id, name, timezone, lat, lng, city, state")
    .in("id", ids);
  return new Map((data ?? []).map((s) => [s.id as string, s as SpaceRow]));
}

function areaOf(space: SpaceRow | undefined): string | null {
  if (!space) return null;
  return [space.city, space.state].filter(Boolean).join(", ") || null;
}

function ctxFrom(request: RequestRow, space: SpaceRow | undefined): WorkNotifyContext {
  return {
    requestId: request.id,
    className: request.title,
    spaceName: space?.name ?? null,
    startsAt: new Date(request.starts_at),
    timeZone: request.time_zone,
    payCents: request.pay_cents,
  };
}

/* ------------------------------------------------------------------ */
/*  Host: post / cancel                                                */
/* ------------------------------------------------------------------ */

export async function postCoverage(
  admin: SupabaseClient,
  hostId: string,
  input: CoverageRequestInput,
  now: Date = new Date(),
): Promise<WorkResult<{ requestId: string }>> {
  const { data: host } = await admin.from("profiles").select("account_type").eq("id", hostId).maybeSingle();
  if (host?.account_type !== "host") return { ok: false, reason: "not_a_host" };
  // Studio Pro (or a Founding free period) is required to post — server-side, so
  // a lapsed host cannot post through a stale client or a direct API call.
  if (!(await loadEntitlements(admin, hostId, now)).canPostCoverage) {
    return { ok: false, reason: "not_entitled" };
  }

  if (!input.spaceId) return { ok: false, reason: "space_required" };
  const { data: space } = await admin
    .from("spaces")
    .select("id, host_id, name, timezone, lat, lng, city, state")
    .eq("id", input.spaceId)
    .maybeSingle();
  if (!space || space.host_id !== hostId) return { ok: false, reason: "space_not_yours" };

  if (input.classTemplateId) {
    const { data: tpl } = await admin
      .from("class_templates")
      .select("id, host_id")
      .eq("id", input.classTemplateId)
      .maybeSingle();
    if (!tpl || tpl.host_id !== hostId) return { ok: false, reason: "template_not_yours" };
  }

  const startsAt = input.startsAt;
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "invalid_time" };
  }
  const duration = Math.max(15, Math.min(480, Math.round(input.durationMinutes)));
  const endsAt = new Date(startsAt.getTime() + duration * MINUTE_MS);
  const timeZone = isKnownZone(space.timezone) ? space.timezone : FALLBACK_ZONE;

  const { data: created, error } = await admin
    .from("work_requests")
    .insert({
      host_id: hostId,
      class_template_id: input.classTemplateId ?? null,
      space_id: space.id,
      title: input.title,
      profession: input.profession,
      // Snapshot the session context onto the request, so editing or archiving
      // the source template later never changes a live or historical request.
      ...sessionDetailsToRow(input),
      level: input.level,
      participants_max: input.participantsMax,
      equipment_notes: input.equipmentNotes,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      time_zone: timeZone,
      pay_cents: Math.max(0, Math.round(input.payCents)),
      notes: input.notes,
      urgent: input.urgent,
      state: "open",
      expires_at: startsAt.toISOString(),
    })
    .select("*")
    .single();
  if (error || !created) throw error ?? new Error("Could not create coverage request");

  // No match-based fan-out on post: the board is browse-all, so a new listing is
  // not pushed at anyone. Notifications fire on real actions instead — a host is
  // told when someone applies, a practitioner when they are confirmed.
  return { ok: true, value: { requestId: created.id as string } };
}

export async function cancelCoverage(
  admin: SupabaseClient,
  hostId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<WorkResult<null>> {
  const { data: request } = await admin
    .from("work_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, reason: "request_not_found" };
  if (request.host_id !== hostId) return { ok: false, reason: "request_not_yours" };

  const effective = effectiveRequestState(
    { state: request.state as WorkRequestState, startsAt: new Date(request.starts_at), endsAt: new Date(request.ends_at) },
    now,
  );
  if (effective !== "open" && effective !== "draft") return { ok: false, reason: "request_not_open" };

  await admin
    .from("work_requests")
    .update({ state: "cancelled", cancelled_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", requestId);

  // Tell everyone who was interested — best-effort.
  const { data: interests } = await admin
    .from("work_interest")
    .select("practitioner_id")
    .eq("request_id", requestId)
    .in("state", ["interested", "confirmed"]);
  const space = (await loadSpaces(admin, [request.space_id as string])).get(request.space_id as string);
  const ctx = ctxFrom(request as RequestRow, space);
  for (const row of interests ?? []) {
    await notifyWorkRequestCancelled(admin, row.practitioner_id as string, ctx).catch(() => {});
  }

  return { ok: true, value: null };
}

/**
 * Duplicate / repost a request into a fresh open one at a new time.
 *
 * The whole session context is copied from the source row — a repost of a class
 * that expired or was cancelled is one tap, not a re-fill of the form — but it
 * goes through postCoverage, so ownership, entitlement, the future-time check and
 * the snapshot all hold exactly as they do for a new post. It never carries over
 * applicants: a repost is a new request nobody has applied to yet.
 */
export async function duplicateCoverage(
  admin: SupabaseClient,
  hostId: string,
  sourceRequestId: string,
  startsAt: Date,
  now: Date = new Date(),
): Promise<WorkResult<{ requestId: string }>> {
  const { data: src } = await admin
    .from("work_requests")
    .select("*")
    .eq("id", sourceRequestId)
    .maybeSingle();
  if (!src) return { ok: false, reason: "request_not_found" };
  if (src.host_id !== hostId) return { ok: false, reason: "request_not_yours" };

  const durationMinutes = Math.round(
    (new Date(src.ends_at as string).getTime() - new Date(src.starts_at as string).getTime()) / MINUTE_MS,
  );
  const details = sessionDetailsFromRow(src as unknown as Record<string, unknown>);
  const input: CoverageRequestInput = {
    spaceId: (src.space_id as string | null) ?? null,
    classTemplateId: (src.class_template_id as string | null) ?? null,
    title: src.title as string,
    profession: (src.profession as string | null) ?? null,
    level: (src.level as string | null) ?? null,
    participantsMax: (src.participants_max as number | null) ?? null,
    equipmentNotes: (src.equipment_notes as string | null) ?? null,
    startsAt,
    durationMinutes: durationMinutes >= 15 ? durationMinutes : 60,
    payCents: src.pay_cents as number,
    notes: (src.notes as string | null) ?? null,
    urgent: Boolean(src.urgent),
    ...details,
  };
  return postCoverage(admin, hostId, input, now);
}

/* ------------------------------------------------------------------ */
/*  Practitioner: express / withdraw interest                          */
/* ------------------------------------------------------------------ */

export async function expressInterest(
  admin: SupabaseClient,
  practitionerId: string,
  requestId: string,
  message: string | null,
  now: Date = new Date(),
): Promise<WorkResult<{ interestId: string }>> {
  const { data: request } = await admin
    .from("work_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, reason: "request_not_found" };
  if (
    !acceptsInterest(
      { state: request.state as WorkRequestState, startsAt: new Date(request.starts_at), endsAt: new Date(request.ends_at) },
      now,
    )
  ) {
    return { ok: false, reason: "request_not_open" };
  }

  // A browseable board means the practitioner decides whether to apply — no
  // modality/availability/distance filter gates this. What still holds:
  //  - Pro + a verified professional profile (canApplyToWork), server-checked;
  //  - no self-match (a host cannot apply to their own request).
  if (request.host_id === practitionerId) return { ok: false, reason: "not_matchable" };
  const ent = await loadEntitlements(admin, practitionerId, now);
  if (ent.canBrowseWork && !ent.canApplyToWork) return { ok: false, reason: "not_eligible" };
  if (!ent.canApplyToWork) return { ok: false, reason: "not_entitled" };

  // Idempotent: a fresh interest, or reviving a withdrawn one. A confirmed,
  // declined, or already-interested row is left as it is.
  const { data: existing } = await admin
    .from("work_interest")
    .select("id, state")
    .eq("request_id", requestId)
    .eq("practitioner_id", practitionerId)
    .maybeSingle();

  let interestId: string;
  if (!existing) {
    const { data: created, error } = await admin
      .from("work_interest")
      .insert({ request_id: requestId, practitioner_id: practitionerId, state: "interested", message })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("Could not record interest");
    interestId = created.id as string;
  } else if (existing.state === "withdrawn") {
    await admin
      .from("work_interest")
      .update({ state: "interested", message, decided_at: null })
      .eq("id", existing.id);
    interestId = existing.id as string;
  } else if (existing.state === "interested") {
    interestId = existing.id as string;
  } else {
    return { ok: false, reason: "already_decided" };
  }

  const space = (await loadSpaces(admin, [request.space_id as string])).get(request.space_id as string);
  const ctx = ctxFrom(request as RequestRow, space);
  void notifyWorkInterestReceived(admin, request.host_id as string, ctx).catch(() => {});

  return { ok: true, value: { interestId } };
}

export async function withdrawInterest(
  admin: SupabaseClient,
  practitionerId: string,
  interestId: string,
  now: Date = new Date(),
): Promise<WorkResult<null>> {
  const { data: interest } = await admin
    .from("work_interest")
    .select("id, request_id, practitioner_id, state")
    .eq("id", interestId)
    .maybeSingle();
  if (!interest) return { ok: false, reason: "interest_not_found" };
  if (interest.practitioner_id !== practitionerId) return { ok: false, reason: "interest_not_yours" };
  if (interest.state === "declined" || interest.state === "withdrawn") {
    return { ok: true, value: null };
  }

  const wasConfirmed = interest.state === "confirmed";
  await admin
    .from("work_interest")
    .update({ state: "withdrawn", decided_at: now.toISOString() })
    .eq("id", interestId);

  if (wasConfirmed) {
    // A confirmed practitioner pulling out reopens the request so the studio can
    // choose again, and tells the host their cover fell through.
    const { data: request } = await admin
      .from("work_requests")
      .select("*")
      .eq("id", interest.request_id)
      .maybeSingle();
    if (request && request.state === "filled" && request.filled_interest_id === interestId) {
      await admin
        .from("work_requests")
        .update({ state: "open", filled_interest_id: null, filled_at: null, updated_at: now.toISOString() })
        .eq("id", interest.request_id);
      const space = (await loadSpaces(admin, [request.space_id as string])).get(request.space_id as string);
      void notifyWorkSelectionWithdrawn(admin, request.host_id as string, ctxFrom(request as RequestRow, space)).catch(() => {});
    }
  }

  return { ok: true, value: null };
}

/* ------------------------------------------------------------------ */
/*  Host: confirm one, atomically                                      */
/* ------------------------------------------------------------------ */

export async function confirmInterest(
  admin: SupabaseClient,
  hostId: string,
  requestId: string,
  interestId: string,
  now: Date = new Date(),
): Promise<WorkResult<{ interestId: string }>> {
  const { data: request } = await admin
    .from("work_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, reason: "request_not_found" };
  if (request.host_id !== hostId) return { ok: false, reason: "request_not_yours" };

  // Confirming is a managing action — it needs an active Studio Pro (or a
  // Founding free period). A lapsed studio can still see its applicants and
  // history, but cannot choose a new cover until it resubscribes.
  if (!(await loadEntitlements(admin, hostId, now)).canManageApplicants) {
    return { ok: false, reason: "not_entitled" };
  }

  // The database does the atomic part: locks the request, confirms one, declines
  // the rest, flips to filled — all or nothing. Returns null if it could not.
  const { data: confirmed, error } = await admin.rpc("confirm_work_interest", {
    p_request_id: requestId,
    p_interest_id: interestId,
  });
  if (error) throw error;
  if (!confirmed) return { ok: false, reason: "already_filled" };

  const { data: interest } = await admin
    .from("work_interest")
    .select("practitioner_id")
    .eq("id", interestId)
    .maybeSingle();
  if (interest) {
    const space = (await loadSpaces(admin, [request.space_id as string])).get(request.space_id as string);
    void notifyWorkConfirmed(admin, interest.practitioner_id as string, ctxFrom(request as RequestRow, space)).catch(() => {});
  }

  return { ok: true, value: { interestId: confirmed as string } };
}

/* ------------------------------------------------------------------ */
/*  Reads: opportunities (practitioner) and interest (host)            */
/* ------------------------------------------------------------------ */

function passesFilters(row: RequestRow & Record<string, unknown>, f: BoardFilters): boolean {
  if (f.profession && row.profession !== f.profession) return false;
  if (f.sessionFormat && (row as { session_format?: string }).session_format !== f.sessionFormat) return false;
  if (f.level && (row as { level?: string }).level !== f.level) return false;
  if (f.urgentOnly && !row.urgent) return false;
  if (f.minPayCents != null && row.pay_cents < f.minPayCents) return false;
  const start = new Date(row.starts_at).getTime();
  if (f.onOrAfter && start < f.onOrAfter.getTime()) return false;
  if (f.onOrBefore && start > f.onOrBefore.getTime()) return false;
  return true;
}

/**
 * The coverage job board: every open, future request, browseable by any Pro
 * practitioner — no matching, no availability gate, no algorithmic exclusion.
 * The optional filters only narrow the browse. Only safe previews leave the
 * server (area not street, no host id, coarse distance).
 *
 * A practitioner without Work Pro sees ONLY their own existing applications —
 * never the open board — because managing what you already committed to is never
 * gated, but browsing new coverage is a Pro feature. The client shows the Pro
 * upsell in place of the board; this is the server half of that same rule.
 */
export async function listOpportunities(
  admin: SupabaseClient,
  practitionerId: string,
  filters: BoardFilters = {},
  now: Date = new Date(),
): Promise<WorkOpportunity[]> {
  const [candidate, ent] = await Promise.all([
    loadCandidates(admin, [practitionerId], now).then((m) => m.get(practitionerId)),
    loadEntitlements(admin, practitionerId, now),
  ]);
  const base = candidate?.facts.base ?? null;

  const { data: myInterest } = await admin
    .from("work_interest")
    .select("id, request_id, state")
    .eq("practitioner_id", practitionerId);
  const interestByRequest = new Map(
    (myInterest ?? []).map((i) => [
      i.request_id as string,
      { id: i.id as string, state: i.state as WorkInterestState },
    ]),
  );

  // The open board is Pro-only; a free (or lapsed) practitioner gets an empty
  // board and only their engaged rows below, so they can still manage them.
  const { data: openData } = ent.canBrowseWork
    ? await admin
        .from("work_requests")
        .select("*")
        .eq("state", "open")
        .gt("starts_at", now.toISOString())
    : { data: [] as RequestRow[] };
  const openRows = (openData ?? []) as RequestRow[];
  const openIds = new Set(openRows.map((r) => r.id));

  // Requests the practitioner is actively engaged with but which are no longer
  // in the open set (filled/past) — fetched so their application status shows.
  const engagedMissing = [...interestByRequest.entries()]
    .filter(([id, s]) => !openIds.has(id) && (s.state === "interested" || s.state === "confirmed"))
    .map(([id]) => id);
  let rows = openRows;
  if (engagedMissing.length > 0) {
    const { data: extra } = await admin.from("work_requests").select("*").in("id", engagedMissing);
    rows = [...openRows, ...((extra ?? []) as RequestRow[])];
  }

  const spaces = await loadSpaces(admin, rows.map((r) => r.space_id as string));

  const opportunities: WorkOpportunity[] = [];
  for (const row of rows) {
    const mine = interestByRequest.get(row.id) ?? null;
    const engaged = mine?.state === "interested" || mine?.state === "confirmed";
    // Filters narrow the browse; a request the practitioner is actively engaged
    // with is always kept so they never lose track of an application.
    if (!engaged && !passesFilters(row as RequestRow & Record<string, unknown>, filters)) continue;

    const space = spaces.get(row.space_id as string);
    const details = sessionDetailsFromRow(row as unknown as Record<string, unknown>);
    const dist =
      base && space?.lat != null && space?.lng != null
        ? distanceLabel(distanceBetween(base, { lat: space.lat, lng: space.lng }, "mi"))
        : null;
    opportunities.push({
      requestId: row.id,
      title: row.title,
      profession: row.profession,
      sessionFormat: details.sessionFormat,
      level: (row as { level?: string | null }).level ?? null,
      requiredQualifications: details.requiredQualifications,
      participantsExpected: details.participantsExpected,
      participantsMax: (row as { participants_max?: number | null }).participants_max ?? null,
      spaceName: space?.name ?? null,
      area: areaOf(space),
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      timeZone: row.time_zone,
      payCents: row.pay_cents,
      notes: row.notes,
      urgent: row.urgent,
      distanceLabel: dist,
      interestState: mine?.state ?? null,
      interestId: mine?.id ?? null,
      state: effectiveRequestState(
        { state: row.state, startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at) },
        now,
      ),
    });
  }

  // Urgent first, then soonest — a sort order, never a visibility filter.
  opportunities.sort(
    (a, b) => Number(b.urgent) - Number(a.urgent) || a.startsAt.getTime() - b.startsAt.getTime(),
  );
  return opportunities;
}

export async function listRequestInterest(
  admin: SupabaseClient,
  hostId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<WorkResult<RequestInterest[]>> {
  const { data: request } = await admin
    .from("work_requests")
    .select("id, host_id, space_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, reason: "request_not_found" };
  if (request.host_id !== hostId) return { ok: false, reason: "request_not_yours" };

  const { data: interests } = await admin
    .from("work_interest")
    .select("id, practitioner_id, state, message, created_at")
    .eq("request_id", requestId)
    .in("state", ["interested", "confirmed"])
    .order("created_at", { ascending: true });
  if (!interests || interests.length === 0) return { ok: true, value: [] };

  const ids = interests.map((i) => i.practitioner_id as string);
  const candidates = await loadCandidates(admin, ids, now);
  const space = (await loadSpaces(admin, [request.space_id as string])).get(request.space_id as string);
  const spacePoint: LatLng | null =
    space?.lat != null && space?.lng != null ? { lat: space.lat, lng: space.lng } : null;

  const value: RequestInterest[] = [];
  for (const interest of interests) {
    const loaded = candidates.get(interest.practitioner_id as string);
    if (!loaded) continue;
    const { preview, facts } = loaded;
    const confirmed = interest.state === "confirmed";
    const full = preview.displayName ?? "A professional";
    const dist =
      facts.base && spacePoint
        ? distanceLabel(distanceBetween(facts.base, spacePoint, "mi"))
        : null;
    const avatarUrl = preview.avatarPath
      ? admin.storage.from("avatars").getPublicUrl(preview.avatarPath).data.publicUrl
      : null;
    value.push({
      interestId: interest.id as string,
      displayName: maskName(preview.displayName),
      fullName: confirmed ? full : null,
      avatarUrl,
      craft: professionLabel(facts.profession) ?? "Wellness professional",
      foundingPractitioner: preview.foundingPractitioner,
      distanceLabel: dist,
      message: (interest.message as string | null) ?? null,
      state: interest.state as WorkInterestState,
      createdAt: new Date(interest.created_at as string),
      identityVerified: preview.identityVerified,
      insuranceVerified: preview.insuranceVerified,
      credentialReviewed: preview.credentialReviewed,
      completedSessions: preview.completedSessions,
      goodStanding: preview.goodStanding,
    });
  }

  return { ok: true, value };
}

/** "Sarah Miller" -> "Sarah M." — partial identity until confirmed. */
export function maskName(name: string | null): string {
  if (!name) return "A professional";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/* ------------------------------------------------------------------ */
/*  My Roster — a studio's own trusted substitute network              */
/* ------------------------------------------------------------------ */

/** Confirmed covers per practitioner for this host — the real relationship the
 *  roster is built from, counted from interest rows so it cannot drift. */
async function confirmedCountsForHost(
  admin: SupabaseClient,
  hostId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data: reqs } = await admin.from("work_requests").select("id").eq("host_id", hostId);
  const ids = (reqs ?? []).map((r) => r.id as string);
  if (ids.length === 0) return counts;
  const { data: interests } = await admin
    .from("work_interest")
    .select("practitioner_id, state")
    .in("request_id", ids)
    .eq("state", "confirmed");
  for (const i of interests ?? []) {
    const pid = i.practitioner_id as string;
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  return counts;
}

export async function listRoster(
  admin: SupabaseClient,
  hostId: string,
  now: Date = new Date(),
): Promise<WorkResult<RosterMember[]>> {
  if (!(await loadEntitlements(admin, hostId, now)).canUseRoster) {
    return { ok: false, reason: "not_entitled" };
  }
  const { data: rows } = await admin
    .from("work_roster")
    .select("id, practitioner_id, note, added_at")
    .eq("host_id", hostId)
    .order("added_at", { ascending: false });
  if (!rows || rows.length === 0) return { ok: true, value: [] };

  const ids = rows.map((r) => r.practitioner_id as string);
  const [candidates, counts] = await Promise.all([
    loadCandidates(admin, ids, now),
    confirmedCountsForHost(admin, hostId),
  ]);

  const value: RosterMember[] = [];
  for (const row of rows) {
    const pid = row.practitioner_id as string;
    const loaded = candidates.get(pid);
    // A closed account leaves the row but drops out of the list safely.
    if (!loaded) continue;
    const { preview, facts } = loaded;
    const avatarUrl = preview.avatarPath
      ? admin.storage.from("avatars").getPublicUrl(preview.avatarPath).data.publicUrl
      : null;
    value.push({
      id: row.id as string,
      practitionerId: pid,
      displayName: preview.displayName ?? "A professional",
      avatarUrl,
      craft: professionLabel(facts.profession) ?? "Wellness professional",
      foundingPractitioner: preview.foundingPractitioner,
      note: (row.note as string | null) ?? null,
      timesWorkedTogether: counts.get(pid) ?? 0,
      availableForWork: facts.availableForWork,
      addedAt: new Date(row.added_at as string),
    });
  }
  return { ok: true, value };
}

export async function addToRoster(
  admin: SupabaseClient,
  hostId: string,
  practitionerId: string,
  note: string | null,
  now: Date = new Date(),
): Promise<WorkResult<{ id: string }>> {
  if (!(await loadEntitlements(admin, hostId, now)).canUseRoster) {
    return { ok: false, reason: "not_entitled" };
  }
  // A roster entry is earned: the host must have confirmed this practitioner for
  // at least one class. No cold-adding a stranger from a preview.
  const counts = await confirmedCountsForHost(admin, hostId);
  if (!counts.has(practitionerId)) return { ok: false, reason: "no_relationship" };

  const { data, error } = await admin
    .from("work_roster")
    .upsert(
      { host_id: hostId, practitioner_id: practitionerId, note },
      { onConflict: "host_id,practitioner_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Could not add to roster");
  return { ok: true, value: { id: data.id as string } };
}

export async function removeFromRoster(
  admin: SupabaseClient,
  hostId: string,
  rosterId: string,
): Promise<WorkResult<null>> {
  // Scoped to the host's own row — a delete that matches nothing is still a
  // success, so a double-tap is harmless.
  const { error } = await admin
    .from("work_roster")
    .delete()
    .eq("id", rosterId)
    .eq("host_id", hostId);
  if (error) throw error;
  return { ok: true, value: null };
}

/**
 * Invite a roster member to a specific open request. This is a notification, not
 * an assignment — the practitioner still applies and is confirmed the normal way,
 * so a roster can never bypass the atomic single-fill. A closed or unreachable
 * account fails softly rather than half-sending.
 */
export async function inviteFromRoster(
  admin: SupabaseClient,
  hostId: string,
  requestId: string,
  practitionerId: string,
  now: Date = new Date(),
): Promise<WorkResult<null>> {
  if (!(await loadEntitlements(admin, hostId, now)).canUseRoster) {
    return { ok: false, reason: "not_entitled" };
  }
  const { data: request } = await admin
    .from("work_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, reason: "request_not_found" };
  if (request.host_id !== hostId) return { ok: false, reason: "request_not_yours" };
  if (
    !acceptsInterest(
      { state: request.state as WorkRequestState, startsAt: new Date(request.starts_at), endsAt: new Date(request.ends_at) },
      now,
    )
  ) {
    return { ok: false, reason: "request_not_open" };
  }

  // Must be on this host's roster, and the account must still exist.
  const { data: onRoster } = await admin
    .from("work_roster")
    .select("id")
    .eq("host_id", hostId)
    .eq("practitioner_id", practitionerId)
    .maybeSingle();
  if (!onRoster) return { ok: false, reason: "practitioner_unavailable" };

  const { data: prof } = await admin
    .from("profiles")
    .select("id, account_type")
    .eq("id", practitionerId)
    .maybeSingle();
  if (!prof || prof.account_type !== "practitioner") {
    return { ok: false, reason: "practitioner_unavailable" };
  }

  const space = (await loadSpaces(admin, [request.space_id as string])).get(request.space_id as string);
  const ctx = ctxFrom(request as RequestRow, space);
  void notifyWorkOpportunity(admin, practitionerId, ctx).catch(() => {});
  return { ok: true, value: null };
}
