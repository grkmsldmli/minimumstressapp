-- A room's hours belong to the room's own city.
--
-- Availability is stored as a weekday and a minute of the day: "Tuesday, 540"
-- means Tuesday at 9am. Nowhere did it say 9am *where*, and the code turned
-- those minutes into real instants using whichever timezone the running
-- process happened to be in. In a browser that is the practitioner's zone; on
-- the server it is UTC. The phone offered 4pm Pacific, the server rebuilt the
-- same grid in UTC, the two never matched, and every booking was rejected as
-- an hour the host had not opened.
--
-- The missing fact was never in the code. It was here: a schedule of wall-clock
-- times with no zone attached cannot be converted to instants at all. So the
-- zone is stored beside the coordinates it comes from.
--
-- Derived from lat/lng rather than typed, because a host picking their own
-- address already told us where the room is, and asking them to also name a
-- timezone is asking the same question twice with more ways to get it wrong.
-- Postgres cannot do that lookup — it knows every zone's rules but not which
-- zone covers a point — so the app resolves it and writes it here.

alter table spaces
  add column if not exists timezone text not null default 'America/Los_Angeles';

-- Shape only. Whether a zone actually exists is a question for the tz database,
-- which Postgres has and the check cannot reach from a constraint, so the app
-- validates against Intl before writing. This stops the empty strings and the
-- 'PST' abbreviations, which are the mistakes that actually happen.
alter table spaces
  drop constraint if exists spaces_timezone_is_iana;

alter table spaces
  add constraint spaces_timezone_is_iana
  check (timezone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_.-]+)+$');

comment on column spaces.timezone is
  'IANA zone of the room itself, e.g. America/Los_Angeles. Availability minutes '
  'are wall-clock times in this zone. Resolved from lat/lng at write time.';

-- 0019 revoked blanket update on spaces and grants one column at a time, so a
-- new column is read-only until it is named here. It changes with the address,
-- and the address is editable.
grant update (timezone) on spaces to authenticated;

-- ------------------------------------------------------------------
-- The zone is public, because the hours are.
--
-- A practitioner has to be told when the room is open before deciding to book
-- it, and a list of wall-clock hours with no zone is not an answer. It gives
-- nothing away either: the neighbourhood is already shown, and a timezone is a
-- far coarser fact than that.
--
-- Adding it here rather than relying on the column existing: the client reads
-- this view with `select *`, so a column missing from it arrives as undefined
-- and falls back to Pacific — every listing on earth quietly on one clock,
-- with nothing failing to say so.
-- ------------------------------------------------------------------
drop view if exists spaces_public;

create view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, timezone, status, created_at,
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

/*
 * The default above is a starting value for the four rows that already exist,
 * every one of them in the Bay Area. It is deliberately not a promise: the app
 * always sends a resolved zone on insert, and the day a listing is created
 * outside Pacific time without one, that listing is wrong in an obvious way
 * rather than a silent one.
 */
