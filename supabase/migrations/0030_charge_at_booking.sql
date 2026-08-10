-- The money is taken when the booking is made, and the host is paid after the
-- session. Two different moments, so two different columns.
--
-- It used to be one. The card was authorised at booking and captured at the
-- session, and Stripe split that capture between us and the host in the same
-- instant — so "captured_at" answered both "did we get paid" and "did the host
-- get paid" at once, because they were the same event.
--
-- They are not the same event any more. Charging up front means the money sits
-- with us for as long as the booking is in the future, and the host's rate is
-- transferred once the hour has actually happened. That gap is the whole
-- reason the change works: a cancellation before the session refunds out of
-- our balance and never touches an account the host has already seen money
-- arrive in.
--
-- `captured_at` keeps its meaning — the practitioner's money reached us — and
-- the rest is new.

alter table bookings
  add column if not exists host_paid_at timestamptz,
  add column if not exists stripe_transfer_id text,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_cents integer;

comment on column bookings.captured_at is
  'When the practitioner''s card was charged. At booking now, not at the session.';
comment on column bookings.host_paid_at is
  'When the host''s rate was transferred to their connected account, after the session.';
comment on column bookings.refunded_cents is
  'What went back to the practitioner. Null when nothing did.';

-- A refund without an amount, or an amount without a refund, means one of the
-- two writes did not happen — and the payout sweep reads both.
alter table bookings
  drop constraint if exists bookings_refund_consistent;

alter table bookings
  add constraint bookings_refund_consistent
  check (
    (refunded_at is null and refunded_cents is null)
    or (refunded_at is not null and refunded_cents is not null and refunded_cents >= 0)
  );

-- Likewise: a transfer id is the receipt for the payout, and one without the
-- other would leave the sweep unable to tell a paid host from an unpaid one.
alter table bookings
  drop constraint if exists bookings_payout_consistent;

alter table bookings
  add constraint bookings_payout_consistent
  check (
    (host_paid_at is null and stripe_transfer_id is null)
    or (host_paid_at is not null and stripe_transfer_id is not null)
  );

/*
 * The sweep reads this on every run: sessions that have happened, whose money
 * we are holding, that have not been refunded and whose host has not been paid.
 */
create index if not exists bookings_awaiting_payout
  on bookings (starts_at)
  where host_paid_at is null and captured_at is not null and refunded_at is null;

-- ------------------------------------------------------------------
-- Nobody but the platform writes any of this.
--
-- 0002 granted the practitioner and host views their own columns; these are
-- ours. A host being able to write host_paid_at would be a host able to mark
-- themselves paid.
-- ------------------------------------------------------------------
revoke update (host_paid_at, stripe_transfer_id, refunded_at, refunded_cents)
  on bookings from authenticated;
