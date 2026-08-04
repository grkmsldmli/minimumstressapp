-- Where a listing sits on the illustrated browse map.
--
-- `lat`/`lng` already existed and stayed empty, because nothing geocoded an
-- address — the wizard collected a tap on a drawing. They are now filled from
-- the address the host picks, and they remain private: released only through
-- space_access_details, to someone who already holds a booking.
--
-- map_x / map_y are the separate, public question. The map on Discover is a
-- picture, not a locator, precisely because an address is private until it is
-- booked; putting real coordinates there would undo the rule the rest of the
-- schema spends its effort enforcing. So the browse position is derived from
-- the real one at an ~11 km granularity (see toBrowsePosition in src/lib/geo.ts)
-- and only that derived value is exposed.
--
-- Stored rather than computed in the view: the derivation would otherwise need
-- lat/lng in a view anon can select from, which is the leak this exists to
-- avoid.

alter table spaces
  add column if not exists map_x numeric(4,1) not null default 50,
  add column if not exists map_y numeric(4,1) not null default 50;

-- The illustration is 6..94 by 8..92 — a pin is drawn from its point upward,
-- so a value at the very edge would render half outside the frame.
do $$
begin
  alter table spaces add constraint spaces_map_position_in_frame
    check (map_x between 6 and 94 and map_y between 8 and 92);
exception
  when duplicate_object then null;
end $$;

create or replace view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, status, created_at,
    description, amenities, requirements, house_rules,
    map_x, map_y
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
