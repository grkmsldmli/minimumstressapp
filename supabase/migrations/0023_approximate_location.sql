-- Roughly where, so a map can be a map.
--
-- The browse map was a hand-drawn SVG: painted roads, painted parks, and pins
-- placed by `map_x`/`map_y` — two decorative numbers from the prototype that
-- correspond to nothing. It looked like a map, so somebody reading it believed
-- they were being told where a room is. They were not.
--
-- The reason it was a drawing is sound and does not change: a listing's exact
-- position is private until it has been booked, and plotting the real point
-- would hand every address to anybody who opened the app.
--
-- What this adds is the middle that most marketplaces settle on. Each listing
-- gets a point offset by a few hundred metres, computed here and exposed
-- instead of the real one. A practitioner can see which part of town a room is
-- in and how far it is; nobody can see which building.
--
-- Two properties make the offset safe:
--
--   Deterministic. Derived from the listing id, so it does not move between
--   requests. A point that jitters on every refresh can be averaged back to
--   the true position by asking repeatedly, which would defeat the whole
--   thing.
--
--   Computed in the view. The real coordinates never enter the response, so
--   there is no client that could be trusted incorrectly and no field that
--   might be read by something we did not write.

-- An angle and a distance, rather than a random point in a square.
--
-- Offsetting each axis independently seemed fine and was not: measured over
-- two hundred listings the displacement ranged from 42m to 547m, and one in
-- fourteen landed under 100m. A published point 42m from the door is not a
-- neighbourhood, it is the building.
--
-- Picking a direction and a distance instead puts every listing in a band —
-- never nearer than MIN, never further than MAX — so there is no listing whose
-- approximate position is nearly its real one.
create or replace function approx_offset_metres(seed uuid)
returns double precision
language sql
immutable
parallel safe
as $$
  -- 250m to 450m. Far enough that the point is not the address; close enough
  -- that "twenty minutes away" is still true.
  select 250 + (abs(hashtext(seed::text || ':distance')) % 201);
$$;

create or replace function approx_bearing_radians(seed uuid)
returns double precision
language sql
immutable
parallel safe
as $$
  /*
   * Stable for a given listing, which is the property that matters. A point
   * that moved between requests could be averaged back to the true position
   * by asking repeatedly, which would defeat all of this.
   */
  select radians((abs(hashtext(seed::text || ':bearing')) % 360)::double precision);
$$;

create or replace function approx_lat(id uuid, lat double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select case when lat is null then null
    else round(
      (lat + (approx_offset_metres(id) * cos(approx_bearing_radians(id))) / 111320.0)::numeric,
      5
    )::double precision
  end;
$$;

create or replace function approx_lng(id uuid, lat double precision, lng double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select case when lng is null or lat is null then null
    /*
     * Longitude degrees narrow towards the poles, so the same distance is a
     * wider angle further north. Without the cosine the offset would collapse
     * to nothing in Reykjavik and be correct only at the equator.
     */
    else round(
      (
        lng
        + (approx_offset_metres(id) * sin(approx_bearing_radians(id)))
          / (111320.0 * greatest(cos(radians(lat)), 0.01))
      )::numeric,
      5
    )::double precision
  end;
$$;

-- Dropped rather than replaced, for the same reason as 0022: a re-run must
-- not fail against a database that already has the wider view.
drop view if exists spaces_public;

create view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, status, created_at,
    description, amenities, requirements, house_rules,
    map_x, map_y,
    public_area(address_line) as area,
    approx_lat(id, lat) as approx_lat,
    approx_lng(id, lat, lng) as approx_lng
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
