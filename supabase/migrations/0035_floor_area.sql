-- How big the room actually is.
--
-- Capacity answers "how many people fit", which is the host's judgement about
-- their own room and varies with what they picture happening in it. A studio
-- that seats twelve for meditation seats four for movement, and the listing
-- said twelve either way.
--
-- Square feet is the fact underneath the judgement. Somebody planning a mat
-- class knows what 400 square feet means for eight people in a way that
-- "capacity 8" never tells them, and it is the number every commercial
-- listing already carries — a retail studio knows its own floor area.
--
-- Optional, because a host who does not know should say nothing rather than
-- guess. An invented measurement is worse than a missing one: somebody would
-- plan around it.

alter table spaces
  add column if not exists floor_area_sqft integer;

comment on column spaces.floor_area_sqft is
  'Usable floor area in square feet. Null when the host has not said.';

-- A room smaller than a cupboard or larger than a warehouse is a typo, and a
-- typo here is somebody arriving at a room a tenth of the size they planned
-- a class around.
alter table spaces
  drop constraint if exists spaces_floor_area_sane;

alter table spaces
  add constraint spaces_floor_area_sane
  check (floor_area_sqft is null or (floor_area_sqft >= 50 and floor_area_sqft <= 50000));

-- 0019 grants updates per column; a new one is read-only to its owner until
-- it is named here.
grant update (floor_area_sqft) on spaces to authenticated;

-- ------------------------------------------------------------------
-- Published, like every other fact somebody decides on.
--
-- Rebuilt in full rather than altered: the client reads this view with
-- `select *`, so a column missing from it arrives as undefined and the listing
-- silently shows nothing, with nothing anywhere failing to say so.
-- ------------------------------------------------------------------
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
    address_line,
    lat,
    lng,
    public_area(address_line) as area
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
