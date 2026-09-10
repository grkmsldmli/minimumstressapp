import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CoverageRequestInput,
  RequestInterest,
  WorkInterestState,
  WorkOpportunity,
  WorkRequestState,
} from "./domain";
import { distanceBetween, distanceLabel } from "./distance";
import type { LatLng } from "./geo";
import type { InsuranceFacts } from "./insurance";
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
import {
  type CandidateFacts,
  type RequestFacts,
  matchCandidate,
  rankCandidates,
} from "./work/matching";
import { acceptsInterest, effectiveRequestState } from "./work/request-state";

/**
 * The server half of Work: matching, notification, and the mutations that must
 * outrank the signed-in user (posting, confirming atomically, cancelling). All
 * of it runs on the admin client passed in — so, like every admin-path write,
 * ownership is re-checked in code here, not left to a policy the admin bypasses.
 *
 * Matching is TypeScript, not SQL: it reuses the exact pure predicates the
 * booking gate uses (lib/work/matching, lib/work/eligibility), so "matchable"
 * and "bookable" cannot drift, and the only thing that ever leaves the server is
 * a coarse, safe preview (a masked name, a distance label, the trust booleans).
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
  | "already_decided"
  | "interest_not_found"
  | "interest_not_yours"
  | "already_filled"
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
    case "already_decided":
      return { message: "This has already been decided.", status: 409 };
    case "already_filled":
      return { message: "This request was just filled. Nothing was changed.", status: 409 };
    case "invalid_time":
      return { message: "Choose a time in the future.", status: 400 };
  }
}

const MINUTE_MS = 60_000;
/** How many matched practitioners a single posted request will alert. */
const MAX_OPPORTUNITY_ALERTS = 50;

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

function requestFactsFrom(request: RequestRow, space: SpaceRow | undefined): RequestFacts {
  return {
    hostId: request.host_id,
    profession: request.profession,
    startsAt: new Date(request.starts_at),
    endsAt: new Date(request.ends_at),
    payCents: request.pay_cents,
    space: space?.lat != null && space?.lng != null ? { lat: space.lat, lng: space.lng } : null,
  };
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

  // Match and alert eligible, opted-in practitioners — best-effort.
  void alertMatches(admin, created as RequestRow, space as SpaceRow, now).catch(() => {});

  return { ok: true, value: { requestId: created.id as string } };
}

async function alertMatches(
  admin: SupabaseClient,
  request: RequestRow,
  space: SpaceRow,
  now: Date,
): Promise<void> {
  const { data: prefs } = await admin
    .from("work_preferences")
    .select("practitioner_id")
    .eq("available_for_work", true);
  const ids = (prefs ?? []).map((p) => p.practitioner_id as string);
  if (ids.length === 0) return;

  const candidates = await loadCandidates(admin, ids, now);
  const requestFacts = requestFactsFrom(request, space);
  const ranked = rankCandidates(
    requestFacts,
    [...candidates.values()].map((c) => c.facts),
    now,
  );
  const ctx = ctxFrom(request, space);
  for (const { candidate } of ranked.slice(0, MAX_OPPORTUNITY_ALERTS)) {
    await notifyWorkOpportunity(admin, candidate.practitionerId, ctx).catch(() => {});
  }
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

  // The practitioner must genuinely match — this is the server gate behind the
  // client's opportunity list, and it also refuses a self-match.
  const candidate = (await loadCandidates(admin, [practitionerId], now)).get(practitionerId);
  if (!candidate) return { ok: false, reason: "not_matchable" };
  const space = (await loadSpaces(admin, [request.space_id as string])).get(request.space_id as string);
  const result = matchCandidate(requestFactsFrom(request as RequestRow, space), candidate.facts, now);
  if (!result.matches) return { ok: false, reason: "not_matchable" };

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
  _now: Date = new Date(),
): Promise<WorkResult<{ interestId: string }>> {
  const { data: request } = await admin
    .from("work_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, reason: "request_not_found" };
  if (request.host_id !== hostId) return { ok: false, reason: "request_not_yours" };

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

export async function listOpportunities(
  admin: SupabaseClient,
  practitionerId: string,
  now: Date = new Date(),
): Promise<WorkOpportunity[]> {
  const candidate = (await loadCandidates(admin, [practitionerId], now)).get(practitionerId);
  if (!candidate) return [];

  // The practitioner's own interests, whatever their state, so status is always
  // visible even after they toggle availability off.
  const { data: myInterest } = await admin
    .from("work_interest")
    .select("request_id, state")
    .eq("practitioner_id", practitionerId);
  const interestByRequest = new Map(
    (myInterest ?? []).map((i) => [i.request_id as string, i.state as WorkInterestState]),
  );

  // Open requests to match against (only when available), plus every request the
  // practitioner already has an interest on.
  const requestIds = new Set(interestByRequest.keys());
  let openRows: RequestRow[] = [];
  if (candidate.facts.availableForWork) {
    const { data } = await admin
      .from("work_requests")
      .select("*")
      .eq("state", "open")
      .gt("starts_at", now.toISOString());
    openRows = (data ?? []) as RequestRow[];
    for (const r of openRows) requestIds.add(r.id);
  }

  if (requestIds.size === 0) return [];

  const { data: allRows } = await admin
    .from("work_requests")
    .select("*")
    .in("id", [...requestIds]);
  const rows = (allRows ?? []) as RequestRow[];
  const spaces = await loadSpaces(admin, rows.map((r) => r.space_id as string));

  const opportunities: WorkOpportunity[] = [];
  for (const row of rows) {
    const mine = interestByRequest.get(row.id) ?? null;
    const space = spaces.get(row.space_id as string);
    // New opportunities (no interest yet) must actually match; ones they have
    // already engaged with are always shown for status.
    if (!mine) {
      if (!candidate.facts.availableForWork) continue;
      if (!matchCandidate(requestFactsFrom(row, space), candidate.facts, now).matches) continue;
    }
    const dist =
      candidate.facts.base && space?.lat != null && space?.lng != null
        ? distanceLabel(distanceBetween(candidate.facts.base, { lat: space.lat, lng: space.lng }, "mi"))
        : null;
    opportunities.push({
      requestId: row.id,
      title: row.title,
      profession: row.profession,
      spaceName: space?.name ?? null,
      area: areaOf(space),
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      timeZone: row.time_zone,
      payCents: row.pay_cents,
      notes: row.notes,
      urgent: row.urgent,
      distanceLabel: dist,
      interestState: mine,
      state: effectiveRequestState(
        { state: row.state, startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at) },
        now,
      ),
    });
  }

  opportunities.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
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
