-- Location goes back behind the booking.
--
-- 0032 published the exact street address, and 0049 kept the precise lat/lng in
-- spaces_public too, on the reasoning that these are retail studios already on
-- their own websites. That is no longer the rule: before a booking is
-- confirmed, a public or merely signed-in user should learn only roughly where
-- a room is — the city, the area, and a point offset a few hundred metres. The
-- exact address, the precise coordinates and the entry instructions come back
-- only through space_access_details(), which already checks the caller holds a
-- booking and is unchanged here.
--
-- The coarse point (approx_lat/approx_lng, 0023) and the coarse area
-- (public_area, 0022) already exist; this reverts the view to them and stops
-- exposing the real values.
--
-- Transition safety. The client shipped before this migration selects
-- address_line by name from spaces_public and reads it via select(*), so
-- dropping the columns outright would 500 its listing pages in the window
-- between this migration and the new deploy. Instead the three sensitive
-- columns are kept in the shape old code expects but forced to NULL — the exact
-- data is gone now, and nothing breaks whichever side rolls out first. Once the
-- old client is no longer served a later migration can drop the names.
--
-- Dropped rather than replaced: create-or-replace cannot change a view's column
-- set. Nothing in the database reads spaces_public (the inventory views read
-- the base table), so the drop has no dependents.

drop view if exists spaces_public;

create view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, timezone, status, created_at,
    description, amenities, requirements, house_rules,
    map_x, map_y,
    entrance_access, floor_access, doorway_inches, restroom_access,
    parking, parking_limit_minutes,
    floor_area_sqft,
    public_area(address_line) as area,
    approx_lat(id, lat) as approx_lat,
    approx_lng(id, lat, lng) as approx_lng,
    -- Deprecated, kept NULL for a safe rollout (see header). The exact street
    -- and precise point are no longer exposed; the names remain only so the
    -- previously deployed client's explicit select does not error mid-rollout.
    null::text as address_line,
    null::double precision as lat,
    null::double precision as lng,
    city, state, postal_code, suitable_for, room_setup,
    allowed_uses, booking_mode
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
