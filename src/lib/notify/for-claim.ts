import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { claimType, overstayCents, type ClaimKind } from "../claims";
import { formatWhen, recipientFor } from "./for-booking";
import { notify } from "./send";

/**
 * Telling both sides about a studio's claim.
 *
 * The practitioner is told before anything is decided, because being charged
 * for something you were never asked about is how a marketplace earns a
 * chargeback and loses a user in one move. Both are told afterwards, because
 * "upheld but the card refused" is a different fact from "rejected" and only
 * one of them is worth arguing with.
 *
 * Failures are swallowed. The claim is real whether or not the mail provider
 * is, and throwing here would undo a decision somebody already made.
 */

interface ClaimRow {
  id: string;
  kind: ClaimKind;
  detail: string;
  host_id: string;
  minutes_over: number | null;
  claimed_cents: number | null;
  charged_cents: number | null;
  decision_note: string | null;
  collection_error: string | null;
  bookings: {
    id: string;
    starts_at: string;
    practitioner_id: string;
    spaces: { name: string; timezone: string; hourly_rate_cents: number };
  };
}

async function loadClaim(admin: SupabaseClient, claimId: string): Promise<ClaimRow | null> {
  const { data } = await admin
    .from("studio_claims")
    .select(
      "id, kind, detail, host_id, minutes_over, claimed_cents, charged_cents, decision_note, collection_error, bookings!inner(id, starts_at, practitioner_id, spaces!inner(name, timezone, hourly_rate_cents))",
    )
    .eq("id", claimId)
    .maybeSingle();

  return (data as ClaimRow | null) ?? null;
}

/** What this would cost, so the practitioner is not answering a blank. */
function likelyAmount(claim: ClaimRow): number | undefined {
  const type = claimType(claim.kind);
  if (type.fixedCents !== null) return type.fixedCents;

  if (claim.kind === "overstay") {
    return overstayCents(claim.minutes_over ?? 0, claim.bookings.spaces.hourly_rate_cents);
  }

  return claim.claimed_cents ?? undefined;
}

export async function notifyClaimFiled(admin: SupabaseClient, claimId: string): Promise<void> {
  try {
    const claim = await loadClaim(admin, claimId);
    if (!claim) return;

    const practitioner = await recipientFor(admin, claim.bookings.practitioner_id);
    if (!practitioner) return;

    await notify({
      kind: "claim_filed",
      recipient: practitioner,
      subjectId: claimId,
      bookingId: claim.bookings.id,
      context: {
        spaceName: claim.bookings.spaces.name,
        when: formatWhen(new Date(claim.bookings.starts_at), claim.bookings.spaces.timezone),
        // The label, not the enum key. "overstay" is not a word anybody uses.
        reason: claimType(claim.kind).label.toLowerCase(),
        note: claim.detail,
        amountCents: likelyAmount(claim),
      },
    });
  } catch (error) {
    console.error(`Claim notification failed for ${claimId}:`, error);
  }
}

/** Both sides, because they need different halves of the same answer. */
export async function notifyClaimDecided(admin: SupabaseClient, claimId: string): Promise<void> {
  try {
    const claim = await loadClaim(admin, claimId);
    if (!claim) return;

    const [practitioner, host] = await Promise.all([
      recipientFor(admin, claim.bookings.practitioner_id),
      recipientFor(admin, claim.host_id),
    ]);

    const when = formatWhen(new Date(claim.bookings.starts_at), claim.bookings.spaces.timezone);

    if (practitioner) {
      await notify({
        kind: "claim_decided",
        recipient: practitioner,
        subjectId: `${claimId}:practitioner`,
        bookingId: claim.bookings.id,
        context: {
          spaceName: claim.bookings.spaces.name,
          when,
          amountCents: claim.charged_cents ?? 0,
          note: claim.decision_note ?? undefined,
          // The collection failure is the host's business, not theirs — a
          // practitioner whose card was refused already knows from their bank.
        },
      });
    }

    if (host) {
      await notify({
        kind: "claim_decided",
        recipient: host,
        subjectId: `${claimId}:host`,
        bookingId: claim.bookings.id,
        context: {
          spaceName: claim.bookings.spaces.name,
          when,
          amountCents: claim.charged_cents ?? 0,
          note: claim.decision_note ?? undefined,
          reason: claim.collection_error ?? undefined,
        },
      });
    }
  } catch (error) {
    console.error(`Claim decision notification failed for ${claimId}:`, error);
  }
}
