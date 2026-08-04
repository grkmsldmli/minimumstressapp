import "server-only";

import type { StripeGateway } from "../booking-service";
import { authorizeBooking, settle } from "../stripe/client";
import { settlementFor } from "../stripe/payments";

/**
 * Adapts the Stripe client to the narrow interface `booking-service` asks for.
 *
 * The service depends on this shape rather than on Stripe directly, which is
 * what lets the booking rules be tested without a network — and what would let
 * a second processor slot in without touching the money logic.
 */
export const stripeGateway: StripeGateway = {
  authorize: (money, hostAccountId, meta) => authorizeBooking(money, hostAccountId, meta),

  settle: async (paymentIntentId, capturedCents, outcome) => {
    await settle(paymentIntentId, settlementFor(outcome, capturedCents));
  },
};
