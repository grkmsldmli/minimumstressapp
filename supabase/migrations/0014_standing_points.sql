-- Points, computed from what happened rather than stored.
--
-- There is no points column anywhere, on purpose. A stored balance can drift
-- from the events that produced it — a job that ran twice, a job that never
-- ran, a manual correction nobody wrote down — and once it has drifted there is
-- no way to settle an argument about it. This view recomputes from bookings and
-- reviews every time, so the number is always explainable: every point traces
-- to a session or a review somebody can be shown.
--
-- The scoring itself lives in src/lib/standing-points.ts and is tested there.
-- The constants are repeated here because SQL cannot import them, which is a
-- real duplication — standing_points.test.ts asserts they still agree.

drop view if exists standing_points;

create view standing_points
with (security_invoker = false) as
with
  -- A session counts only when money moved between two different people.
  -- Without the practitioner_id <> host_id check, a host with a second account
  -- books their own room and both sides collect, having paid only our fee.
  paid_sessions as (
    select
      b.practitioner_id,
      s.host_id,
      b.id as booking_id
    from bookings b
    join spaces s on s.id = b.space_id
    where b.status = 'completed'
      and b.captured_at is not null
      and b.practitioner_id <> s.host_id
  ),

  session_points as (
    select practitioner_id as user_id, count(*) * 15 as points from paid_sessions group by practitioner_id
    union all
    select host_id as user_id, count(*) * 15 as points from paid_sessions group by host_id
  ),

  -- Clean means nothing was raised against them on that session.
  clean_points as (
    select p.practitioner_id as user_id, count(*) * 2 as points
    from paid_sessions p
    where not exists (
      select 1 from reviews r
      where r.booking_id = p.booking_id and r.subject_id = p.practitioner_id and r.safety_concern
    )
    group by p.practitioner_id
    union all
    select p.host_id as user_id, count(*) * 2 as points
    from paid_sessions p
    where not exists (
      select 1 from reviews r
      where r.booking_id = p.booking_id and r.subject_id = p.host_id and r.safety_concern
    )
    group by p.host_id
  ),

  -- Stars on reviews *about* you, and only on sessions that counted — so a
  -- self-booked five stars is worth nothing either.
  review_points as (
    select r.subject_id as user_id, sum(r.overall) * 2 as points
    from reviews r
    join paid_sessions p on p.booking_id = r.booking_id
    group by r.subject_id
  ),

  -- Cancellations inside 24 hours, from whichever side did it.
  penalty_points as (
    select b.practitioner_id as user_id, count(*) * -25 as points
    from bookings b
    where b.status = 'cancelled_by_practitioner'
      and b.cancelled_at > b.starts_at - interval '24 hours'
    group by b.practitioner_id
    union all
    select s.host_id as user_id, count(*) * -25 as points
    from bookings b
    join spaces s on s.id = b.space_id
    where b.status = 'cancelled_by_host'
      and b.cancelled_at > b.starts_at - interval '24 hours'
    group by s.host_id
  ),

  -- An escalation that a person looked at and upheld. Open ones score nothing:
  -- a report is not a finding, and docking somebody before anybody has read it
  -- would make an accusation into a penalty.
  upheld_points as (
    select r.subject_id as user_id, count(*) * -100 as points
    from review_escalations e
    join reviews r on r.id = e.review_id
    where e.state = 'resolved' and e.note is not null
    group by r.subject_id
  )

select
  user_id,
  -- Floored at zero: a negative score keeps punishing after the punishment,
  -- and suspension is where repeated cancellation is actually handled.
  greatest(0, sum(points))::int as points
from (
  select * from session_points
  union all select * from clean_points
  union all select * from review_points
  union all select * from penalty_points
  union all select * from upheld_points
) all_points
group by user_id
/*
 * Your own row, and the filter is inside the view because it has to be.
 *
 * This is a security definer view, so it reads the base tables with the
 * owner's rights and no row policy applies — granting select without this
 * would hand every signed-in account everyone else's total. A points total is
 * not a vanity number: it is fifteen per paid session, so it divides straight
 * back into how many sessions somebody has had and, with a published rate,
 * roughly what they earned.
 *
 * auth.uid() is null for the service role, so staff read the base tables
 * directly rather than through here.
 */
having user_id = auth.uid();

grant select on standing_points to authenticated;
