-- Where somebody leaves the car.
--
-- A practitioner arriving by car asks three things in this order: is there
-- anywhere to park, will it cost me, and can I leave it there for the whole
-- session. The listing answered none of them, so the only way to find out was
-- to message the host and wait — or to turn up and find out.
--
-- The third question is the one that matters most here and the one a listings
-- site normally has no field for. This marketplace sells hours. A two-hour
-- street limit is fine; a one-hour limit on a one-hour session means leaving
-- mid-session to move the car, or a ticket.
--
-- Several answers at once, because a studio can have two spaces out front and
-- a street anybody can use. One choice would make the host pick the better one
-- and leave out the one somebody actually needed.

alter table spaces
  add column if not exists parking text[] not null default '{}',
  add column if not exists parking_limit_minutes integer;

comment on column spaces.parking is
  'Keys from PARKING_OPTIONS in src/lib/parking.ts. Empty means unanswered, '
  'which is shown as unanswered rather than as "no parking".';
comment on column spaces.parking_limit_minutes is
  'How long a car may stay. Null means no limit.';

-- A limit of zero or a negative one is not a stricter rule, it is a mistake.
-- The upper bound is a day: anything longer is "no limit" and belongs as null.
alter table spaces
  drop constraint if exists spaces_parking_limit_sane;

alter table spaces
  add constraint spaces_parking_limit_sane
  check (
    parking_limit_minutes is null
    or (parking_limit_minutes > 0 and parking_limit_minutes <= 1440)
  );

-- 0019 revoked the blanket update and grants per column, so a new column stays
-- read-only to its own owner until it is named here.
grant update (parking, parking_limit_minutes) on spaces to authenticated;

-- ------------------------------------------------------------------
-- Public, for the same reason the accessibility answers are.
--
-- None of it locates the room — "street parking" is true of most streets — and
-- it is read while deciding, which is before a booking exists.
--
-- Rebuilt in full rather than altered: the client reads this view with
-- `select *`, so a column missing from it arrives as undefined and the listing
-- silently shows nothing, with no error anywhere to say so.
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
    public_area(address_line) as area,
    approx_lat(id, lat) as approx_lat,
    approx_lng(id, lat, lng) as approx_lng
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
