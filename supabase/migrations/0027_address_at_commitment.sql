-- The address arrives when the booking becomes committed.
--
-- It used to arrive the moment a booking existed. That left a hole with no
-- cost attached to it: book a room, read the address, cancel more than 24
-- hours out, and the authorisation is voided in full. Nothing charged, nothing
-- counted against standing, and the exact address of somebody's studio
-- collected for free. Repeat for every listing on the board.
--
-- The 24-hour line already marks the moment a booking stops being free to walk
-- away from — cancel inside it and the full amount is captured. So that is the
-- moment the address is worth its cost, and it is the same boundary the refund
-- policy and the standing rules use. One line, three consequences, nothing new
-- to explain.
--
-- A booking made inside the window is committed from the start, so it reveals
-- immediately. Nobody waits for a line they are already past.
--
-- What does not change: the area was always public, so a practitioner has
-- known roughly where the room is since before they booked. This withholds the
-- doorway, not the neighbourhood.

create or replace function space_access_details(p_space_id uuid)
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
         * Inside the free-cancellation window, or already past.
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
