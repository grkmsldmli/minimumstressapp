-- Whether the room is yours for the hour, and what you will find in it.
--
-- Two gaps a practitioner hit on every listing.
--
-- The first: `amenities` held eight values and every one described the
-- building — mirrors, climate control, natural light, soundproofing. Nothing
-- described what is actually in the room. Somebody looking at a Holistic
-- Practice Room could not tell whether there was a treatment table; somebody
-- looking at a movement studio could not tell whether the reformers came with
-- it or the host expected them to bring their own. That is the first question
-- after the price and it was unanswerable.
--
-- That half needs no migration. The column is a text[] with no constraint, and
-- the vocabulary lives in src/lib/taxonomy.ts, which has grown equipment
-- alongside the room's own qualities.
--
-- The second does: whether the room is private, a room inside a shared studio,
-- or the whole place. Capacity and category hint at it and neither says it,
-- and for anybody seeing one person at a time it decides whether the room is
-- usable at all.

alter table spaces
  add column if not exists room_setup text not null default 'private_room';

comment on column spaces.room_setup is
  'private_room | room_in_studio | whole_studio — see ROOM_SETUPS in src/lib/taxonomy.ts.';

/*
 * Constrained, unlike amenities, because this one is a single value that the
 * listing prints as a claim about privacy. A typo here would render as no
 * label at all, which reads as a room declining to say — the opposite of what
 * a host ticking "private room" meant.
 */
alter table spaces drop constraint if exists spaces_room_setup_known;

alter table spaces add constraint spaces_room_setup_known check (
  room_setup in ('private_room', 'room_in_studio', 'whole_studio')
);

/*
 * The public view, carrying it. Dropped and recreated rather than replaced:
 * `create or replace view` cannot add a column in the middle, and the grants
 * go with the drop, so they are restated.
 */
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
    -- Public since 0032: every listing is a retail studio whose address is
    -- already on its own website. How to get in is still not here.
    address_line,
    lat,
    lng,
    public_area(address_line) as area,
    city, state, postal_code, suitable_for, room_setup
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
