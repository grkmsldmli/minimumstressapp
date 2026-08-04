-- Who booked my room?
--
-- 0004 narrowed public_host_profiles to actual hosts, which was right — a
-- practitioner has no public presence in this product — but it left a real gap:
-- a host must be able to see who is coming into their space, and that name now
-- lives behind RLS they cannot cross.
--
-- The answer is not to widen the public view back out. It is a function scoped
-- to exactly the relationship that justifies the access: you may see a
-- practitioner's name because they hold a booking on a space *you own*.
--
-- Note what it returns and what it does not. host_rate_cents is the host's net,
-- and no service fee, instant fee or platform figure appears anywhere in the
-- signature. The brief is explicit that hosts see earnings, never a percentage,
-- and leaving those columns out means a careless `select *` on the client
-- cannot leak them.

create or replace function host_bookings()
returns table (
  booking_id uuid,
  space_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status booking_status,
  net_cents integer,
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
  order by b.starts_at;
$$;

revoke all on function host_bookings() from public;
grant execute on function host_bookings() to authenticated;
