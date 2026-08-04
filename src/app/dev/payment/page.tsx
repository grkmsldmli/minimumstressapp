import { notFound } from "next/navigation";

import { bookingMoneyFromQuote, quote } from "@/lib/money";
import { stripe } from "@/lib/stripe/client";
import { BOOKING_PAYMENT_METHODS } from "@/lib/stripe/payment-methods";

import { PaymentPreviewClient } from "./preview-client";

/**
 * Design surface for the payment sheet.
 *
 * The sheet needs a live PaymentIntent to render, which makes it the one screen
 * that cannot be reviewed from the mock repository. This creates a real
 * sandbox intent so the card fields, the appearance rules and the copy can be
 * looked at without walking a whole booking through.
 *
 * Development only — `notFound()` in production keeps it out of the built app
 * entirely rather than relying on nobody finding the URL.
 */
export default async function PaymentPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  // $45 room on an instant slot: $45 + $9 fee + $5 instant.
  const money = bookingMoneyFromQuote(
    quote({ hostRateCents: 4500, isInstant: true, isPro: false, creditBalanceCents: 0 }),
  );

  // No transfer_data here: routing to a host's account needs a verified
  // connected account, and none of that affects what this screen renders. The
  // destination arithmetic is covered in src/lib/stripe/payments.test.ts.
  const intent = await stripe().paymentIntents.create({
    amount: money.totalCents,
    currency: "usd",
    capture_method: "manual",
    // The same list authorizeBooking uses, imported rather than repeated, so
    // the preview cannot drift into showing a sheet the real flow never makes.
    payment_method_types: [...BOOKING_PAYMENT_METHODS],
    metadata: { preview: "true" },
  });

  return (
    <main className="w-full flex items-center justify-center py-8">
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: 385,
          height: 780,
          borderRadius: 44,
          border: "9px solid #16304E",
          boxShadow: "0 40px 90px -30px rgba(22,48,78,0.45)",
        }}
      >
        <PaymentPreviewClient
          clientSecret={intent.client_secret!}
          money={money}
          // Derived from the intent's own timestamp rather than a clock read
          // during render — same result, and it comes from data we already
          // fetched instead of an impure call.
          startsAt={new Date((intent.created + 90 * 60) * 1000).toISOString()}
        />
      </div>
    </main>
  );
}
