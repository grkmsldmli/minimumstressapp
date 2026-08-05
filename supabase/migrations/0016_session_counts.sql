-- Sessions run, replacing the points view.
--
-- 0014 built `standing_points`: a weighted score over sessions, reviews and
-- cancellations, feeding tiers that granted a longer booking window, a waived
-- instant fee and a faster payout. All of it is gone, and the reasoning is
-- worth keeping rather than only the result.
--
-- Every one of those benefits was a rule that had to be explained, tested and
-- reasoned about at the moment somebody was trying to book a room — and none of
-- them made the marketplace work better. What replaces them is a count and
-- three badges at 100, 250 and 500. A badge changes no price and bends no rule,
-- so there is nothing to reconcile when it is wrong.
--
-- The one property carried over is the one that mattered: a session counts only
-- when money moved between two different people. Without it a host books their
-- own room, and a badge that can be manufactured in an afternoon is worth
-- nothing to somebody who spent a year earning one.

drop view if exists standing_points;
drop view if exists session_counts;

create view session_counts
with (security_invoker = false) as
with paid_sessions as (
  select b.practitioner_id, s.host_id
  from bookings b
  join spaces s on s.id = b.space_id
  where b.status = 'completed'
    and b.captured_at is not null
    and b.practitioner_id <> s.host_id
)
select user_id, count(*)::int as sessions
from (
  select practitioner_id as user_id from paid_sessions
  union all
  select host_id as user_id from paid_sessions
) both_sides
group by user_id
/*
 * Your own row, and the filter has to live inside the view.
 *
 * Security definer, so it reads the base tables with the owner's rights and no
 * row policy applies — granting select without this would hand every signed-in
 * account everyone else's session count, which for a host divides straight back
 * into roughly what they have earned.
 *
 * auth.uid() is null for the service role, so staff read the base tables
 * directly rather than through here.
 */
having user_id = auth.uid();

grant select on session_counts to authenticated;
