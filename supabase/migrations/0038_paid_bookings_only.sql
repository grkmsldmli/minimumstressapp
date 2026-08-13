-- A checkout nobody paid for is not a booking, on the host's side either.
--
-- `host_bookings()` has returned every row on a host's spaces since 0005,
-- including the ones sitting at `upcoming` with no `captured_at` — which is
-- what a booking looks like between the row being written and a card being
-- entered, and what it goes on looking like for the thirty minutes before
-- abandoned.ts reaps it.
--
-- So closing the card form put a session on a studio's calendar. The
-- practitioner side had the same hole and the same fix; this is the half that
-- lives in SQL.
--
-- The hour genuinely is held during those thirty minutes — the availability
-- check excludes anything `upcoming`, paid or not, so nobody else can take it
-- — and that is deliberate: the person at the card form should not lose the
-- slot to somebody quicker. But a held hour is not a booking. Showing it as
-- one is how a host rearranges an afternoon around a session that evaporates
-- without a word.
--
-- Cancelled and completed rows keep flowing through. They carry `captured_at`
-- because money did arrive, and a host's history should not lose a session
-- that happened.

create or replace function host_bookings()
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
  practitioner_avatar_path text
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
    p.avatar_path
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
