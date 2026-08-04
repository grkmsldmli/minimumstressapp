/**
 * Which payment methods a booking may be paid with.
 *
 * One list, imported everywhere an intent is created, so the sheet a
 * practitioner sees is always the sheet the booking flow produces. When the
 * preview page and the real route each named their own methods, they could
 * drift — and the screen being reviewed would stop being the screen being
 * shipped.
 *
 * Cards only, for three reasons that are worth keeping written down because
 * "just enable everything" is the tempting default:
 *
 * 1. The cancellation model is card authorisation. Hold now, void free inside
 *    24 hours, capture when the session starts. Bank debit cannot do it at
 *    all — Stripe rejects `us_bank_account` with `capture_method: manual`
 *    outright — so offering it produces a tab that can never complete.
 *
 * 2. Buy-now-pay-later does not belong here. Left to Stripe's automatic
 *    selection the sheet offers Klarna and Affirm, which is consumer
 *    financing for an hour in a yoga room. Beyond the fit, their refund and
 *    dispute handling is nothing like a card hold, and every branch of the
 *    cancellation policy assumes a card hold.
 *
 * 3. It carries promotional copy we do not control. Stripe's own "$5 back
 *    when you pay by bank" banner rendered directly beside our $5 instant
 *    fee, reading as though the two cancelled out. On a screen whose entire
 *    promise is that nothing is added later, a second offer we did not write
 *    and cannot amend is worse than the payment method is worth.
 *
 * Link — Stripe's saved-card wallet — is the one worth revisiting. Same card
 * rails, faster repeat checkout, genuinely useful for a practitioner booking
 * the same room weekly. It waits until it can be enabled without dragging its
 * own promotional surface along with it.
 */
export const BOOKING_PAYMENT_METHODS = ["card"] as const;
