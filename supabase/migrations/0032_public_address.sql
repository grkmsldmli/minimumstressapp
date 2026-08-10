-- The address is public. How to get in is not.
--
-- Every listing here is a retail studio. Its address is on Google Maps, on its
-- own website, on the sign above the door — so withholding the street number
-- protected nothing and cost a practitioner the single fact they judge a room
-- by. "Redwood City, CA 94063" is not somewhere you can decide to go.
--
-- It was never much of a defence against booking off-platform either. One
-- booking and the address is theirs forever; what actually keeps a marketplace
-- together is that the money, the record, the cover and the terms live here.
--
-- What stays behind the booking is the part that is genuinely not public: the
-- entry instructions and the access code. "386 Convention Way" tells somebody
-- where the building is. "Side door, keypad 4021, press # after" tells them how
-- to get inside it, and that belongs to whoever paid for the hour.
--
-- So the approximate coordinates go too. They existed to draw a pin 250-450m
-- from a room we would not name; with the address published, a deliberately
-- wrong pin is just a worse map.

drop view if exists spaces_public;

create view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, timezone, status, created_at,
    description, amenities, requirements, house_rules,
    map_x, map_y,
    entrance_access, floor_access, doorway_inches, restroom_access,
    parking, parking_limit_minutes,
    -- The street, at last. Still nothing about the door.
    address_line,
    lat,
    lng,
    public_area(address_line) as area
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;

/*
 * `entry_instructions` is deliberately absent, as it has always been, and
 * `space_access_details` is left exactly as 0027 wrote it: still gated on
 * holding a booking inside the 24-hour line. It now releases one thing that is
 * already published and one that is not, which is harmless — the caller reads
 * it for the instructions.
 *
 * `area` stays because the browse list uses it as a short label, and a town is
 * easier to scan than a street address in a row of cards.
 */
