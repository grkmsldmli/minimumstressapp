-- A door opens for a paid booking, not for a row.
--
-- Two gates decided who may enter a studio, and both asked whether a booking
-- existed rather than whether it was paid for and still standing.
--
--   The access code. `bookings_with_access_code` revealed it to the
--   practitioner named on the row once the reveal time had passed — with no
--   look at status and none at payment. So a cancelled booking kept its code
--   for good: cancelBooking never cleared it, and the view never asked. Book,
--   wait for the reveal, cancel, and the code is still on screen. A host
--   cancelling on somebody left it with them too.
--
--   The entry instructions. `space_access_details` checked status and the
--   24-hour window, which is why cancelling did take those away. It did not
--   check payment, so an abandoned checkout — `upcoming`, unpaid, waiting for
--   the sweep — could read how to get into the building.
--
-- Neither is theoretical. 0038 has just been through the same family of bug on
-- the money side: a held hour is not a booking, and everything downstream of
-- "a row exists" inherited that mistake. This is the same correction applied
-- where it matters most, because the thing being handed out is not a number on
-- a screen — it is the way into a room somebody owns.
--
-- The direction of failure is deliberate. Adding `captured_at is not null`
-- means a booking we somehow failed to record a capture for loses its code,
-- rather than an unpaid one keeping it. A practitioner locked out can be
-- helped by a person; a stranger let in cannot be undone.

drop view if exists bookings_with_access_code;

create view bookings_with_access_code
  with (security_invoker = true) as
  select
    b.id, b.space_id, b.practitioner_id, b.starts_at, b.ends_at, b.status,
    b.is_instant, b.was_pro, b.host_rate_cents, b.service_fee_cents,
    b.instant_fee_cents, b.pro_discount_cents, b.credit_applied_cents,
    b.total_cents, b.platform_cents, b.captured_at, b.cancelled_at,
    b.cancelled_by, b.access_code_revealed_at, b.created_at,
    case
      when b.practitioner_id = auth.uid()
       and b.access_code_revealed_at <= now()
       -- Still going ahead. A cancelled session is not one to walk into.
       and b.status = 'upcoming'
       -- And paid for. The row exists from the moment somebody reaches the
       -- card form; the hour is theirs only once the money is taken.
       and b.captured_at is not null
        then b.access_code
      else null
    end as revealed_access_code
  from bookings b;

grant select on bookings_with_access_code to authenticated;
grant select on bookings_with_access_code to service_role;

-- ------------------------------------------------------------------
-- The address, the entry instructions and the access type.
--
-- Unchanged except for the payment check. The status and 24-hour rules were
-- already right and their reasoning is kept verbatim below.
-- ------------------------------------------------------------------
create or replace function space_access_details(p_space_id uuid)
-- The column order is 0027's, exactly. Postgres counts the OUT list as part of
-- the signature, so reordering it for readability is a different function and
-- `create or replace` refuses — correctly, since callers read these positionally.
returns table (
  address_line text,
  lat double precision,
  lng double precision,
  entry_instructions text,
  access_type access_type
)
language sql
stable
security definer
set search_path = public
as $$
  select s.address_line, s.lat, s.lng, s.entry_instructions, s.access_type
  from spaces s
  where s.id = p_space_id
    and exists (
      select 1 from bookings b
      where b.space_id = s.id
        and b.practitioner_id = auth.uid()
        and b.status in ('upcoming', 'completed')
        /*
         * Paid for.
         *
         * An abandoned checkout sits at 'upcoming' until the sweep reaches it,
         * and this told it how to get into the building. A completed session
         * is always captured, so nothing legitimate is lost here.
         */
        and b.captured_at is not null
        /*
         * Close enough to need it.
         *
         * `starts_at - now() < 24h` covers both: a session tomorrow morning,
         * and one that happened last week. A completed booking keeps its
         * address — somebody needs to find the place again, and by then they
         * have paid for it.
         */
        and b.starts_at - now() < interval '24 hours'
    );
$$;

revoke all on function space_access_details(uuid) from public;
grant execute on function space_access_details(uuid) to authenticated;
