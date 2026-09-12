import type { NextRequest } from "next/server";
import type Stripe from "stripe";

import { recordEvent } from "@/lib/analytics/record";
import { notifyBookingCreated, notifyRequestMade, recipientFor } from "@/lib/notify/for-booking";
import { notify } from "@/lib/notify/send";
import { stripe } from "@/lib/stripe/client";
import { grantsPro, isStudioProSubscription } from "@/lib/stripe/subscription";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Whether a subscription ever converted to a genuinely PAID state — i.e. it
 * billed at least once, rather than ending inside its trial or before its first
 * charge ever succeeded. This is what separates "the member paid at the discount
 * then let it lapse" (forfeit the 50%) from "they opted in early and cancelled
 * during the free trial" or "their first charge never went through" (keep it).
 *
 * incomplete / incomplete_expired never had a successful first charge. trialing —
 * or a sub whose trial had not yet finished, or that ended at or before its
 * trial_end (including a cancel_at_period_end that lands on trial end without
 * billing) — never billed. Everything else (no trial, or a trial that completed
 * into a paid period) counts as converted.
 */
function subscriptionConvertedToPaid(sub: Stripe.Subscription): boolean {
  if (
    sub.status === "incomplete" ||
    sub.status === "incomplete_expired" ||
    sub.status === "trialing"
  ) {
    return false;
  }
  const trialEnd = sub.trial_end;
  if (trialEnd != null) {
    const nowUnix = Math.floor(Date.now() / 1000);
    if (trialEnd > nowUnix) return false; // the trial had not finished, so nothing billed
    const endedAt = sub.ended_at ?? sub.canceled_at;
    if (endedAt != null && endedAt <= trialEnd) return false; // ended at/before trial end → never billed
  }
  return true;
}

/**
 * Stripe's side of the conversation.
 *
 * Everything here is driven by what Stripe reports, not by what the app hoped
 * would happen. A host is marked payable because Stripe says their account can
 * receive money; a booking is marked captured because the charge succeeded.
 * Optimistic local updates are how a database ends up disagreeing with the
 * ledger that actually holds the money.
 *
 * The signature check is the whole security model — this endpoint is public and
 * anyone can POST to it. Without verification, a forged `account.updated` would
 * let someone mark themselves payable and start taking bookings.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const secrets = signingSecrets();
  if (secrets.length === 0) {
    console.error("STRIPE_WEBHOOK_SECRET is not set; refusing to trust this request");
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  // The raw body, not the parsed one: the signature covers the exact bytes, so
  // anything that reserialises JSON breaks verification.
  const payload = await request.text();

  const event = await verify(payload, signature, secrets);
  if (!event) return new Response("Invalid signature", { status: 400 });

  try {
    await handle(event);
  } catch (error) {
    // A 500 makes Stripe retry, which is what we want for a transient database
    // failure. Returning 200 on error would drop the event permanently.
    console.error(`Failed handling ${event.type}:`, error);
    return new Response("Handler failed", { status: 500 });
  }

  return Response.json({ received: true });
}

/**
 * Stripe splits these events across two endpoints, and we need both.
 *
 * `payment_intent.*` happen on the platform account, because we create the
 * charges. `account.updated` and `payout.failed` happen on the *connected*
 * account, and an endpoint only receives those if it was created with Connect
 * events enabled — which is a separate endpoint, with its own signing secret,
 * even when both point at this same URL.
 *
 * So the variable holds a list. One secret is the ordinary case and behaves
 * exactly as before; the comma is what lets a host ever become payable.
 */
function signingSecrets(): string[] {
  return (process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Returns the event only if some configured secret vouches for it.
 *
 * A failure against one secret says nothing — the request was probably signed
 * by the other endpoint — so nothing is logged until every secret has refused,
 * at which point the request really is unsigned or forged.
 */
async function verify(
  payload: string,
  signature: string,
  secrets: string[],
): Promise<Stripe.Event | null> {
  for (const secret of secrets) {
    try {
      return await stripe().webhooks.constructEventAsync(payload, signature, secret);
    } catch {
      continue;
    }
  }

  console.error(`Webhook signature verified against none of ${secrets.length} secret(s)`);
  return null;
}

async function handle(event: Stripe.Event): Promise<void> {
  const admin = supabaseAdmin();

  switch (event.type) {
    /**
     * The only place a host becomes payable.
     *
     * Both flags matter and neither is enough alone: `charges_enabled` without
     * `payouts_enabled` means money can be taken but never reaches their bank,
     * which is worse than refusing the booking outright.
     */
    case "account.updated": {
      const account = event.data.object;
      const payable = Boolean(account.charges_enabled && account.payouts_enabled);

      await admin
        .from("profiles")
        .update({ stripe_connect_charges_enabled: payable })
        .eq("stripe_connect_account_id", account.id);
      return;
    }

    /**
     * The practitioner's card went through.
     *
     * The status is deliberately left alone. This now fires the moment the
     * payment sheet is completed, which is the start of the booking rather than
     * the end of it — marking it "completed" here would report a session as
     * having happened days before it does, and the payout sweep reads that
     * status to decide who to pay.
     */
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      const { data: paid } = await admin
        .from("bookings")
        .update({ captured_at: new Date().toISOString() })
        .eq("stripe_payment_intent_id", intent.id)
        // Guarded so a replayed event cannot overwrite a time already recorded.
        .is("captured_at", null)
        .select("id, approval_state, practitioner_id");

      /*
       * And this is where the host finds out.
       *
       * It used to be `createBooking`, which runs before the card form is even
       * shown — so a studio was emailed "New booking" for a checkout somebody
       * then closed, and thirty minutes later the reaper took the hour back
       * without telling anyone. Here the money has arrived.
       *
       * Safe on a replay twice over: the guard above means a second delivery
       * selects no rows, and notify() claims a unique dedupe key per kind and
       * subject in any case.
       */
      const booking = paid?.[0];
      /*
       * The one place money is truly captured, and so the honest source for the
       * revenue events the Growth dashboard reads. The update guard means this
       * runs once per booking however many times Stripe redelivers, so the count
       * cannot inflate on a replay. Best-effort: recordEvent never throws into
       * the webhook. No amounts or PII — a booking id and the approval shape only.
       */
      if (booking) {
        // Trusted server emitter — opt in to the server-only business facts.
        await recordEvent(
          admin,
          {
            name: "payment_succeeded",
            userId: (booking.practitioner_id as string | null) ?? null,
            surface: "stripe_webhook",
            properties: { bookingId: booking.id },
          },
          true,
        );
        await recordEvent(
          admin,
          {
            name: "booking_confirmed",
            userId: (booking.practitioner_id as string | null) ?? null,
            surface: "stripe_webhook",
            properties: { bookingId: booking.id, approvalState: booking.approval_state },
          },
          true,
        );
      }
      /*
       * Except when the host has just approved it.
       *
       * With manual capture this event fires at the capture, not at the card
       * form — so for a request it means "the host said yes and the hold was
       * taken", which both sides have already been told about: the host by
       * doing it, the guest by request_approved. Sending "New booking" here
       * would be the third message about one decision.
       */
      if (booking && booking.approval_state !== "approved") {
        await notifyBookingCreated(admin, booking.id);
      }
      return;
    }

    /**
     * A card confirmed against a hold rather than a charge.
     *
     * Only requests reach here, because only they are created for manual
     * capture. It is the true "the request has been made" moment — the guest
     * has entered a card and the money is held — and it is where the host is
     * told, for the same reason `succeeded` is where they are told about an
     * ordinary booking: before this, a request is a form somebody might still
     * close.
     */
    case "payment_intent.amount_capturable_updated": {
      const intent = event.data.object;
      const { data: held } = await admin
        .from("bookings")
        .update({ authorized_at: new Date().toISOString() })
        .eq("stripe_payment_intent_id", intent.id)
        .eq("approval_state", "pending")
        .select("id");

      const requestId = held?.[0]?.id;
      if (requestId) await notifyRequestMade(admin, requestId);
      return;
    }

    /**
     * The payment was abandoned — by our own cancellation route, or by Stripe
     * expiring an intent nobody ever put a card into.
     */
    case "payment_intent.canceled": {
      const intent = event.data.object;
      await admin
        .from("bookings")
        .update({
          status: "cancelled_by_practitioner",
          cancelled_at: new Date().toISOString(),
          cancelled_by: "practitioner",
        })
        .eq("stripe_payment_intent_id", intent.id)
        /*
         * The status guard is what keeps a declined request from being
         * relabelled here.
         *
         * Releasing a hold cancels its intent, so a host declining produces
         * this event within a second or two. approval-service writes the row
         * before it calls Stripe, precisely so that by the time this arrives
         * the booking is no longer `upcoming` and this update matches nothing
         * — otherwise a host's decline would be recorded as the practitioner
         * having cancelled, and that is the version somebody reads back in a
         * dispute.
         */
        .eq("status", "upcoming");
      return;
    }

    /**
     * A practitioner finished the Stripe Identity check and passed.
     *
     * The only place `identity_verified_at` is written — the booking gate reads
     * it, and a practitioner marking themselves is exactly what routing this
     * through Stripe prevents. Matched by the `user_id` we put on the session's
     * metadata, and guarded so a replayed event cannot rewrite a time already
     * recorded. A `requires_input` or `canceled` session sends nothing we act
     * on: unverified stays unverified, which is the safe default the gate needs.
     */
    case "identity.verification_session.verified": {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      if (!userId) return;

      await admin
        .from("profiles")
        .update({ identity_verified_at: new Date().toISOString() })
        .eq("id", userId)
        .is("identity_verified_at", null);
      return;
    }

    /**
     * A payout to a host's bank was rejected — usually a closed account or
     * wrong details. Stripe pauses that account's payouts until it is fixed,
     * so the money is sitting still and the host does not necessarily know.
     *
     * Logged loudly rather than handled silently: this is the case where a
     * host is owed real money and cannot receive it, and nobody finds out
     * unless someone is watching. It becomes an email once Resend is wired.
     */
    case "payout.failed": {
      const payout = event.data.object;
      const reason = payout.failure_message ?? payout.failure_code ?? "no reason given";

      console.error(
        `PAYOUT FAILED — account ${event.account ?? "unknown"}, ${payout.amount} ${payout.currency}: ${reason}`,
      );

      // The log was never enough. Stripe pauses payouts to an account after a
      // return, so without this the host keeps earning, keeps not being paid,
      // and the only record is a line nobody is reading.
      if (!event.account) return;

      const { data: host } = await admin
        .from("profiles")
        .select("id")
        .eq("stripe_connect_account_id", event.account)
        .maybeSingle();
      if (!host) return;

      const recipient = await recipientFor(admin, host.id);
      if (!recipient) return;

      await notify({
        kind: "payout_failed",
        recipient,
        // Per payout, not per host: a second failure is news again.
        subjectId: payout.id,
        context: { reason },
      });
      return;
    }

    /**
     * The only place anybody becomes Pro, or stops being.
     *
     * Not on the checkout redirect: that URL is reachable by anyone who knows
     * it, and a flag set there is a subscription anybody can grant themselves.
     * Stripe sends this when the money actually cleared, and sends it again
     * every renewal, every failure and every cancellation — so the flag tracks
     * the subscription rather than the moment somebody once paid.
     */
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const userId = subscription.metadata?.app_user_id;
      const entitled = grantsPro(subscription.status);
      const nowOrNull = entitled ? new Date().toISOString() : null;

      /*
       * Two products ride the same customer, so which column moves is decided by
       * the subscription's own identity, never by the customer. Studio Pro (host)
       * writes studio_pro; practitioner Pro writes is_pro. Without this a Studio
       * Pro event would wrongly toggle a practitioner's is_pro, and vice-versa.
       */
      const periodEnd = (subscription as { current_period_end?: number }).current_period_end;
      const patch = isStudioProSubscription(subscription)
        ? {
            studio_pro: entitled,
            studio_pro_since: nowOrNull,
            studio_pro_current_period_end: periodEnd
              ? new Date(periodEnd * 1000).toISOString()
              : null,
            studio_pro_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
          }
        : {
            is_pro: entitled,
            pro_since: nowOrNull,
          };

      // Matched by customer id when the metadata is missing — a subscription
      // created from the Stripe dashboard by hand has no metadata, and that is
      // exactly how a support fix gets applied; the price lookup_key still
      // routes it to the right column via isStudioProSubscription.
      const query = admin.from("profiles").update(patch);

      const { error } = userId
        ? await query.eq("id", userId)
        : await query.eq("stripe_customer_id", subscription.customer as string);

      if (error) throw error;

      /*
       * Founding-discount forfeiture — the 50% rate is permanent only while the
       * paid subscription stays continuously active after the user CONVERTS to
       * paid.
       *
       * Forfeit ONLY when a discounted subscription that actually converted to
       * paid then terminally ends. All three gates must hold:
       *  - terminal: the deleted event, or a canceled status (never past_due /
       *    unpaid / incomplete — those may recover, and burning the benefit on a
       *    temporary failure is what rule 5 forbids);
       *  - it carried the founding discount (metadata.founding_discount, stamped
       *    at checkout) — so a full-price resubscribe's end is a no-op and a
       *    non-founding sub never writes it;
       *  - it converted to paid (subscriptionConvertedToPaid) — so a sub that
       *    ended before it ever billed (cancelled during the trial an early
       *    opt-in creates, or a first charge that never succeeds) does NOT
       *    forfeit. Never converting keeps the 50% for the real first conversion.
       *
       * The write sets the timestamp once, only where it is still null, and
       * nothing ever clears it — so duplicate and out-of-order events can neither
       * double-forfeit nor un-forfeit. Founding STATUS is untouched throughout.
       */
      const terminated =
        event.type === "customer.subscription.deleted" || subscription.status === "canceled";
      if (
        terminated &&
        subscription.metadata?.founding_discount === "true" &&
        subscriptionConvertedToPaid(subscription)
      ) {
        const column = isStudioProSubscription(subscription)
          ? "founding_host_discount_forfeited_at"
          : "founding_practitioner_discount_forfeited_at";
        const forfeit = admin
          .from("profiles")
          .update({ [column]: new Date().toISOString() });
        const scoped = userId
          ? forfeit.eq("id", userId)
          : forfeit.eq("stripe_customer_id", subscription.customer as string);
        const { error: forfeitError } = await scoped.is(column, null);
        if (forfeitError) throw forfeitError;
      }
      return;
    }

    /**
     * Recorded, not acted on. Our own refunds already wrote their ledger
     * entries; a refund issued from the Stripe dashboard is a human stepping
     * outside the app, and quietly minting credit for it would be guessing at
     * intent.
     */
    case "charge.refunded": {
      const charge = event.data.object;
      console.info(
        `Charge ${charge.id} refunded ${charge.amount_refunded} of ${charge.amount}`,
      );
      return;
    }

    default:
      return;
  }
}
