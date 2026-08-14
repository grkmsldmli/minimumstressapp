import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ClaimKind,
  claimBlockedBecause,
  claimType,
  explainClaimBlock,
  overstayCents,
  routeClaim,
} from "./claims";
import { notifyClaimDecided, notifyClaimFiled } from "./notify/for-claim";
import { chargeForClaim } from "./stripe/client";

/**
 * The server half of a studio claim: the checks a browser must not be trusted
 * with, and the one irreversible act at the end.
 *
 * Every rule about whether and how much lives in `claims.ts`, pure and tested.
 * What lives here needs the database — is this the host's booking, has the
 * window closed, what does this room charge an hour — plus the charge itself.
 *
 * The rule that shapes all of it: we collect, we do not guarantee. A card that
 * refuses ends the claim as `uncollectable` and the host is told. Nothing here
 * pays a host out of our own balance.
 */

export class ClaimError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface BookingRow {
  id: string;
  practitioner_id: string;
  space_id: string;
  status: string;
  ends_at: string;
  captured_at: string | null;
  host_rate_cents: number;
  stripe_payment_intent_id: string | null;
  spaces: { host_id: string; hourly_rate_cents: number };
}

async function loadBooking(admin: SupabaseClient, bookingId: string): Promise<BookingRow> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, space_id, status, ends_at, captured_at, host_rate_cents, stripe_payment_intent_id, spaces!inner(host_id, hourly_rate_cents)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new ClaimError("No such booking", 404);
  return data as unknown as BookingRow;
}

export interface ClaimInput {
  kind: ClaimKind;
  detail: string;
  evidencePath: string | null;
  minutesOver: number | null;
  claimedCents: number | null;
}

/**
 * Files a claim, and never charges anything doing it.
 *
 * The best outcome here is a figure both sides can see. The practitioner still
 * answers and a person still decides — a route that could charge on arrival
 * would be a route a host could point at anybody.
 */
export async function fileClaim(
  admin: SupabaseClient,
  bookingId: string,
  hostId: string,
  input: ClaimInput,
  now = new Date(),
): Promise<{ state: string; amountCents: number | null; because: string }> {
  const booking = await loadBooking(admin, bookingId);

  // Checked, not trusted: an id in a URL says nothing about who owns the room.
  if (booking.spaces.host_id !== hostId) throw new ClaimError("No such booking", 404);

  /*
   * Both refusals come from claims.ts, so they can be tested without a query
   * builder. The payment one used to read `stripe_payment_intent_id`, which is
   * written when the row is created and survives the sweep that cancels the
   * intent — so an abandoned hour passed it.
   */
  const blocked = claimBlockedBecause({
    status: booking.status,
    capturedAt: booking.captured_at ? new Date(booking.captured_at) : null,
  });
  if (blocked) {
    const { message, status } = explainClaimBlock(blocked);
    throw new ClaimError(message, status);
  }
  if (!booking.stripe_payment_intent_id) {
    throw new ClaimError("That booking has no card on it to charge", 409);
  }

  const sessionEnd = new Date(booking.ends_at);
  const route = routeClaim({
    kind: input.kind,
    sessionEnd,
    now,
    hourlyRateCents: booking.spaces.hourly_rate_cents,
    minutesOver: input.minutesOver ?? 0,
    claimedCents: input.claimedCents,
    hasPhoto: Boolean(input.evidencePath),
  });

  if (route.kind === "closed") {
    // Not written down. A closed claim is one that never became a claim, and a
    // row for it would only ever be a queue item that cannot end in money.
    throw new ClaimError(route.because, 409);
  }

  const { data: created, error } = await admin
    .from("studio_claims")
    .insert({
      booking_id: bookingId,
      host_id: hostId,
      kind: input.kind,
      detail: input.detail,
      evidence_path: input.evidencePath,
      minutes_over: input.minutesOver,
      claimed_cents: input.claimedCents,
      state: "awaiting_practitioner",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ClaimError("You have already filed a claim on this booking", 409);
    }
    throw error;
  }

  await notifyClaimFiled(admin, created.id).catch(() => {});

  return {
    state: "awaiting_practitioner",
    amountCents: route.kind === "priced" ? route.amountCents : null,
    because: route.because,
  };
}

/** The practitioner's account of the same session. */
export async function replyToClaim(
  admin: SupabaseClient,
  claimId: string,
  practitionerId: string,
  reply: string,
  now = new Date(),
): Promise<void> {
  const { data, error } = await admin
    .from("studio_claims")
    .select("id, state, bookings!inner(practitioner_id)")
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ClaimError("No such claim", 404);

  const accused = (data as unknown as { bookings: { practitioner_id: string } }).bookings
    .practitioner_id;
  if (accused !== practitionerId) throw new ClaimError("No such claim", 404);
  if (data.state !== "awaiting_practitioner") {
    throw new ClaimError("This claim is no longer waiting on you", 409);
  }

  const { error: updateError } = await admin
    .from("studio_claims")
    .update({
      practitioner_reply: reply,
      practitioner_replied_at: now.toISOString(),
      // Answering does not close it. The person with money at stake in the
      // outcome cannot be the one who decides it — the same rule that keeps a
      // host from closing a refund request by replying to it.
      state: "awaiting_staff",
    })
    .eq("id", claimId);
  if (updateError) throw updateError;
}

/**
 * Staff decide, and this is the only place a card is charged for a claim.
 *
 * `amountCents` is what staff settled on, not what the host asked for. The
 * fixed kinds are recomputed here rather than read from the row, so a host
 * cannot inflate a published flat rate by editing a payload.
 */
export async function decideClaim(
  admin: SupabaseClient,
  claimId: string,
  staffId: string,
  uphold: boolean,
  amountCents: number,
  note: string,
  now = new Date(),
): Promise<{ state: string; chargedCents: number; error: string | null }> {
  const { data: claim, error } = await admin
    .from("studio_claims")
    .select("id, booking_id, kind, minutes_over, state")
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  if (!claim) throw new ClaimError("No such claim", 404);

  if (!["awaiting_practitioner", "awaiting_staff"].includes(claim.state as string)) {
    throw new ClaimError("This claim has already been decided", 409);
  }

  if (!uphold) {
    await close(admin, claimId, {
      state: "rejected",
      charged_cents: 0,
      decided_by: staffId,
      decided_at: now.toISOString(),
      decision_note: note,
    });
    await notifyClaimDecided(admin, claimId).catch(() => {});
    return { state: "rejected", chargedCents: 0, error: null };
  }

  const booking = await loadBooking(admin, claim.booking_id as string);

  /*
   * Recomputed, never taken from the request. A published flat rate that a
   * caller can name is not a published flat rate.
   */
  const type = claimType(claim.kind as ClaimKind);
  const owed =
    type.fixedCents !== null
      ? type.fixedCents
      : claim.kind === "overstay"
        ? overstayCents((claim.minutes_over as number) ?? 0, booking.spaces.hourly_rate_cents)
        : amountCents;

  if (owed <= 0) throw new ClaimError("An upheld claim has to be worth something", 400);

  const charge = await chargeForClaim(booking.stripe_payment_intent_id ?? "", owed, {
    claimId,
    bookingId: booking.id,
  });

  if (!charge.ok) {
    /*
     * The card refused, and that is where it ends.
     *
     * The host is told, with the record. We do not advance the money and then
     * chase it — that is underwriting, and nobody priced it.
     */
    await close(admin, claimId, {
      state: "uncollectable",
      charged_cents: 0,
      decided_by: staffId,
      decided_at: now.toISOString(),
      decision_note: note,
      collection_error: charge.reason,
    });
    await notifyClaimDecided(admin, claimId).catch(() => {});
    return { state: "uncollectable", chargedCents: 0, error: charge.reason };
  }

  await close(admin, claimId, {
    state: "upheld",
    charged_cents: owed,
    decided_by: staffId,
    decided_at: now.toISOString(),
    decision_note: note,
  });

  /*
   * The charge id, written separately and on purpose.
   *
   * It belongs on the row — this is the only irreversible act in the flow, and
   * a bank asking which charge we mean needs an answer. But the card has
   * already been charged by this point, so it must not share a statement with
   * the close: a deploy that lands before its migration would fail the whole
   * update and leave the claim open with the money taken.
   */
  const { error: idError } = await admin
    .from("studio_claims")
    .update({ stripe_payment_intent_id: charge.chargeId })
    .eq("id", claimId);
  if (idError) {
    console.error(
      `Charged ${charge.chargeId} for claim ${claimId} and could not record it:`,
      idError,
    );
  }
  await notifyClaimDecided(admin, claimId).catch(() => {});

  return { state: "upheld", chargedCents: owed, error: null };
}

/** Closes only from an open state, so two staff cannot charge the same card twice. */
async function close(
  admin: SupabaseClient,
  claimId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("studio_claims")
    .update(patch)
    .eq("id", claimId)
    .in("state", ["awaiting_practitioner", "awaiting_staff"]);
  if (error) throw error;
}

