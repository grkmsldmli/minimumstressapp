import type { NextRequest } from "next/server";
import type Stripe from "stripe";

import { stripe } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/server";

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

    /** Money actually moved. */
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      await admin
        .from("bookings")
        .update({ captured_at: new Date().toISOString(), status: "completed" })
        .eq("stripe_payment_intent_id", intent.id)
        // Guarded so a replayed event cannot reopen a booking that was since
        // cancelled, or overwrite a capture time already recorded.
        .is("captured_at", null);
      return;
    }

    /**
     * The hold was released — by our own cancellation route, or by Stripe
     * letting an uncaptured authorization expire after about a week.
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
        .eq("status", "upcoming");
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
      console.error(
        `PAYOUT FAILED — account ${event.account ?? "unknown"}, ${payout.amount} ${payout.currency}: ${payout.failure_message ?? payout.failure_code ?? "no reason given"}`,
      );
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
