-- The door code stops working when the session ends, not when the host is paid.
--
-- 0039 gated the code on `status = 'upcoming'`, which was right about
-- cancellation and wrong about time. Nothing in this system writes
-- `completed` except the payout sweep, and that runs twice a day — so the
-- window a practitioner holds the code for is not the ninety minutes the
-- constants describe. It is however long it takes for the host to get paid.
--
-- Two ways that goes wrong, in opposite directions.
--
-- Too long: a 7:30am session ends at 8:30 and the code stays live until the
-- 15:00 UTC sweep. If the host has not finished Connect onboarding the sweep
-- skips the row without writing status at all, so the code stays on the
-- practitioner's screen indefinitely — the way into somebody's studio, held
-- open by an unrelated payments problem.
--
-- Too short: a session running across a sweep loses its code halfway through.
-- The practitioner steps out to their car at 8:00, comes back, and "Getting
-- in" is empty.
--
-- So the window is time now, and status is only asked the question it can
-- answer: was this cancelled. `completed` is allowed because a session that
-- has been paid out is not different, from the door's point of view, from one
-- that has not — and `ends_at` closes both cases exactly where they should
-- close.

drop view if exists bookings_with_access_code;

create view bookings_with_access_code
with (security_invoker = true) as
  select
    b.id, b.space_id, b.practitioner_id, b.starts_at, b.ends_at, b.status,
    b.host_rate_cents, b.service_fee_cents,
    b.instant_fee_cents, b.pro_discount_cents, b.credit_applied_cents,
    b.total_cents, b.platform_cents, b.captured_at, b.cancelled_at,
    b.cancelled_by, b.access_code_revealed_at, b.created_at,
    case
      when b.practitioner_id = auth.uid()
       and b.access_code_revealed_at <= now()
       /*
        * Until the hour is over. Not until somebody is paid: the payout is a
        * money event on a twice-daily job, and tying a door to it means the
        * door stays open while a transfer is pending and shuts while a session
        * is still running.
        */
       and now() < b.ends_at
       -- Not cancelled. This is the one thing status is actually being asked.
       and b.status in ('upcoming', 'completed')
       -- And paid for. The row exists from the moment somebody reaches the
       -- card form; the hour is theirs only once the money is taken.
       and b.captured_at is not null
        then b.access_code
      else null
    end as revealed_access_code
  from bookings b;

grant select on bookings_with_access_code to authenticated;
