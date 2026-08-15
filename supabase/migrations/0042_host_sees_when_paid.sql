-- When the money actually reached the host's bank.
--
-- `host_bookings()` returns what a host earned on each session and never says
-- whether it has arrived. So the app can tell somebody a session is done and
-- what it was worth, and cannot tell them the one thing they check for: has it
-- landed.
--
-- Two things want this. milestones.ts marks a host's first payout — the point
-- at which a listing stops being a hope and becomes income, and the moment
-- nothing in the app currently marks. And a host looking at last week's
-- sessions should be able to see which have been settled without opening
-- Stripe.
--
-- Dropped and recreated rather than replaced. `create or replace` cannot change
-- a function's return type at all — not even by appending a column — and says
-- so with "cannot change return type of existing function". 0038's warning
-- that a drop takes the grant with it is the reason the grant is restated at
-- the bottom rather than assumed.

drop function if exists host_bookings();

create function host_bookings()
returns table (
  booking_id uuid,
  space_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status booking_status,
  net_cents integer,
  -- Column names copied from 0005 exactly. Postgres refuses to replace a
  -- function whose output names differ, and renaming one here would mean a
  -- drop, which takes the grant with it.
  practitioner_name text,
  practitioner_avatar_path text,
  -- Null until the transfer has been made. Not "will be paid" — paid.
  host_paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.space_id,
    b.starts_at,
    b.ends_at,
    b.status,
    b.host_rate_cents,
    p.display_name,
    p.avatar_path,
    b.host_paid_at
  from bookings b
  join spaces s on s.id = b.space_id
  join profiles p on p.id = b.practitioner_id
  where s.host_id = auth.uid()
    -- Money arrived, or it never happened.
    and b.captured_at is not null
  order by b.starts_at;
$$;

revoke all on function host_bookings() from public;
grant execute on function host_bookings() to authenticated;
