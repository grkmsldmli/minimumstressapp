-- What we actually charged, and where.
--
-- An upheld claim charges a practitioner's kept card off-session, and until
-- now the row recorded only the amount. Stripe returned a charge id and the
-- service threw it away, so the one irreversible act in the whole claim flow
-- was the only money movement in this app with nothing pointing at it —
-- bookings keep their payment intent, payouts keep their transfer, this kept
-- a number.
--
-- It matters at exactly the moment it is missing. Somebody disputes the
-- seventeen dollars with their bank and we have to answer with evidence tied
-- to that charge; staff decide a claim was wrong and there is nothing to
-- refund against; the month's collections have to be reconciled and there is
-- no key to join on.

alter table studio_claims
  add column if not exists stripe_payment_intent_id text;

comment on column studio_claims.stripe_payment_intent_id is
  'The off-session charge that collected this claim. Null until upheld and paid, and on any claim that was rejected or could not be collected.';

-- Written only by the service role deciding a claim. Nobody on either side of
-- a dispute may touch the record of what was charged.
revoke update (stripe_payment_intent_id) on studio_claims from authenticated;
