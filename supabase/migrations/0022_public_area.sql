-- Which part of town, without which door.
--
-- The public view carried no location at all: no address, no coordinates, no
-- city. A practitioner browsing saw a room called "GamePlay", the word
-- "nearby", and nothing else — and "nearby" is computed from a location they
-- may not have shared, so often it said nothing whatsoever.
--
-- Withholding the street address is right and stays. It protects a host
-- letting a stranger into their building, and it is what stops somebody
-- looking the studio up and booking around us.
--
-- Withholding the town is a different thing, and it was not a decision so much
-- as the same rule applied one level too far. Nobody books an hour in a room
-- they cannot place. Asking somebody to commit their card, their afternoon and
-- their own client to a location they will not be told until afterwards is not
-- privacy, it is a room nobody books.
--
-- So: the first comma-separated segment is dropped and the rest kept.
--
--   stored   1840 Gateway Dr, San Mateo, CA 94404, USA
--   shown    San Mateo, CA 94404, USA
--
-- Google's formatted addresses lead with the street line, which is what makes
-- this reliable. When there is no comma there is no way to tell a street from
-- a town, so nothing is shown rather than guessed — a wrong guess here leaks
-- the address, and the whole point is that it cannot.
--
-- Computed in the view rather than in the client. A column the browser has to
-- be trusted to trim is a column the browser has already been sent.

create or replace function public_area(address text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when address is null then null
    when position(',' in address) = 0 then null
    else btrim(substring(address from position(',' in address) + 1))
  end;
$$;

create or replace view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, status, created_at,
    description, amenities, requirements, house_rules,
    map_x, map_y,
    public_area(address_line) as area
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
