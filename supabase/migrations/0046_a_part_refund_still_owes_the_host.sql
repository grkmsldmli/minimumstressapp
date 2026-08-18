-- A partial refund does not mean the host is owed nothing.
--
-- The payout sweep asked one question — `refunded_at is null` — and treated it
-- as "was any money returned". Refunds are not binary. `our_fee` returns the
-- platform's share and leaves the host's rate untouched, and src/lib/refunds.ts
-- describes it as the honest middle and the outcome most disputes deserve. It
-- is one of the three buttons staff are given.
--
-- So the recommended decision was also the one that stopped the host ever being
-- paid. `refunded_at` gets written for a refund of any size, the sweep excludes
-- the row from then on, and nothing retries. The dashboard's own "finished
-- sessions the studio has not been paid for" counter filtered the same way, so
-- the alert built to catch exactly this could not see it either.
--
-- The right question is not whether money went back. It is whether the money
-- that went back was the host's.
--
-- Answered here rather than in the sweep, because two places already asked it
-- and a third would have been the reporting query. A generated column is
-- computed by Postgres from the row itself: it cannot be forgotten by a caller,
-- it cannot drift from the index built on it, and a refund written by any path
-- updates it.

alter table bookings
  add column if not exists host_rate_refunded boolean
  generated always as (
    /*
     * `total_cents - host_rate_cents` is the platform's share of the booking:
     * the service fee, plus the instant fee where there was one. A refund of
     * exactly that is `our_fee` and leaves the host whole. Anything larger has
     * reached into the host's rate.
     *
     * `refunded_cents` is nullable — nothing has been refunded on most rows —
     * so it is coalesced rather than compared as null.
     */
    coalesce(refunded_cents, 0) > total_cents - host_rate_cents
  ) stored;

comment on column bookings.host_rate_refunded is
  'True once a refund has reached into the host''s own rate. A partial refund of the platform''s share leaves this false and the host still payable.';

/*
 * The index the sweep runs on, rebuilt against the new question.
 *
 * Dropped rather than left beside a second one: an index whose predicate no
 * longer matches the query is an index the planner ignores, and the old
 * predicate is the bug.
 */
drop index if exists bookings_awaiting_payout;

create index if not exists bookings_awaiting_payout
  on bookings (starts_at)
  where host_paid_at is null and captured_at is not null and host_rate_refunded is false;
