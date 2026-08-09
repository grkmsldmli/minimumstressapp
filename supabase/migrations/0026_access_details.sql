-- What "accessible" actually means for this room.
--
-- The column was a boolean, and the screen rendered it as a chip reading
-- "Wheelchair accessible". A wheelchair user cannot act on that. Is there a
-- step at the front door? Is the lift wide enough to turn in? Is the restroom
-- one they can use? The chip answers none of it while looking like an answer,
-- so somebody books, travels, pays, arrives with their own client waiting, and
-- cannot get in.
--
-- A boolean also invites the wrong answer honestly given. A host with one
-- shallow step at the entrance genuinely does not know which box to tick, and
-- most will tick yes because the room itself is fine.
--
-- So: four facts, each one an obstacle somebody is actually stopped by.
-- Structured rather than free text, because free text produces "yes, fully
-- accessible!" — the same claim with more words.
--
-- Null throughout means not answered, which is shown as not answered. An
-- unanswered question is more use than a guess, since a practitioner can ask.

do $$ begin
  create type entrance_access as enum ('step_free', 'one_step', 'steps');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type lift_access as enum ('ground_floor', 'lift', 'stairs_only');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type restroom_access as enum ('accessible', 'standard', 'none');
exception when duplicate_object then null;
end $$;

alter table spaces
  -- Getting from the pavement to the door.
  add column if not exists entrance_access entrance_access,
  -- Getting from the door to the room.
  add column if not exists floor_access lift_access,
  -- The measurement that decides it, in inches. Null when not measured.
  add column if not exists doorway_inches integer,
  add column if not exists restroom_access restroom_access;

alter table spaces
  drop constraint if exists spaces_doorway_plausible;
alter table spaces
  add constraint spaces_doorway_plausible check (
    doorway_inches is null or doorway_inches between 18 and 96
  );

-- ------------------------------------------------------------------
-- Published, because this is what somebody decides on.
--
-- None of it locates the room — a doorway width is not an address — so it
-- belongs in the public view alongside capacity and the room type rather than
-- behind the booking.
-- ------------------------------------------------------------------
drop view if exists spaces_public;

create view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, status, created_at,
    description, amenities, requirements, house_rules,
    map_x, map_y,
    entrance_access, floor_access, doorway_inches, restroom_access,
    public_area(address_line) as area,
    approx_lat(id, lat) as approx_lat,
    approx_lng(id, lat, lng) as approx_lng
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;

-- The host may answer them, like the rest of their listing. 0019 revoked the
-- blanket update and grants per column, so these need adding to that list.
grant update (entrance_access, floor_access, doorway_inches, restroom_access)
  on spaces to authenticated;

-- ------------------------------------------------------------------
-- The old boolean.
--
-- Left in place and left alone. Migrating it would mean inventing answers —
-- "accessible = true" says nothing about which of the four is true — and a
-- fabricated accessibility claim is worse than a missing one. Existing
-- listings show as unanswered until a host answers.
-- ------------------------------------------------------------------
