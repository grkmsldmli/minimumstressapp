import type { SupabaseClient } from "@supabase/supabase-js";

import { formatWhen, recipientFor } from "./for-booking";
import { notify } from "./send";

/**
 * Turning a coverage request into "who needs to be told what".
 *
 * The same shape as for-booking: reads the recipient (email from auth, name
 * from the profile), formats the time in the room's zone, and hands the wording
 * to `notify`, which claims a dedupe key before sending so nothing goes twice.
 * Every notifier is best-effort — the caller fires and forgets, so a mail
 * hiccup never fails the mutation that triggered it.
 *
 * Anti-spam is the subjectId: a whole request is one subject, so a studio is
 * nudged once that its class can be covered and reads the rest in the app, and
 * only the eligible, opted-in practitioners the matcher chose are ever written
 * to — never the marketplace.
 */

export interface WorkNotifyContext {
  requestId: string;
  className: string;
  spaceName: string | null;
  startsAt: Date;
  timeZone: string;
  payCents: number;
}

async function emit(
  admin: SupabaseClient,
  userId: string,
  kind:
    | "work_opportunity"
    | "work_interest_received"
    | "work_confirmed"
    | "work_request_cancelled"
    | "work_selection_withdrawn",
  subjectId: string,
  ctx: WorkNotifyContext,
): Promise<void> {
  const recipient = await recipientFor(admin, userId);
  if (!recipient) return;
  await notify({
    kind,
    recipient,
    subjectId,
    context: {
      spaceName: ctx.spaceName ?? undefined,
      when: formatWhen(ctx.startsAt, ctx.timeZone),
      amountCents: ctx.payCents,
      className: ctx.className,
    },
  });
}

/** A matched, opted-in, eligible practitioner: a relevant request was posted. */
export function notifyWorkOpportunity(
  admin: SupabaseClient,
  practitionerId: string,
  ctx: WorkNotifyContext,
): Promise<void> {
  return emit(admin, practitionerId, "work_opportunity", `${ctx.requestId}:${practitionerId}`, ctx);
}

/** The host: someone can cover the class (once per request). */
export function notifyWorkInterestReceived(
  admin: SupabaseClient,
  hostId: string,
  ctx: WorkNotifyContext,
): Promise<void> {
  return emit(admin, hostId, "work_interest_received", ctx.requestId, ctx);
}

/** The chosen practitioner: you're confirmed. */
export function notifyWorkConfirmed(
  admin: SupabaseClient,
  practitionerId: string,
  ctx: WorkNotifyContext,
): Promise<void> {
  return emit(admin, practitionerId, "work_confirmed", ctx.requestId, ctx);
}

/** Every interested practitioner: the request was cancelled. */
export function notifyWorkRequestCancelled(
  admin: SupabaseClient,
  practitionerId: string,
  ctx: WorkNotifyContext,
): Promise<void> {
  return emit(
    admin,
    practitionerId,
    "work_request_cancelled",
    `${ctx.requestId}:${practitionerId}`,
    ctx,
  );
}

/** The host: the confirmed practitioner withdrew. */
export function notifyWorkSelectionWithdrawn(
  admin: SupabaseClient,
  hostId: string,
  ctx: WorkNotifyContext,
): Promise<void> {
  return emit(admin, hostId, "work_selection_withdrawn", `${ctx.requestId}:withdrawn`, ctx);
}
