-- Which town a room is in, and what it is bookable for.
--
-- Both are needed for the same reason: pages that can be generated rather than
-- written. "Pilates Studios for Rent in San Mateo, CA" is a page somebody
-- searches for, and it can only exist if a query can ask for pilates rooms in
-- San Mateo. Today neither half of that question is answerable.
--
-- The town is not stored at all. `spaces` has `address_line`, and the public
-- view derives an area from it by cutting off everything before the first
-- comma — "1840 Gateway Dr, San Mateo, CA 94404, USA" becomes "San Mateo, CA
-- 94404, USA". That is the right thing to *show* and useless to filter on:
-- it is one string, its shape depends on what Google returned, and matching a
-- town inside it means a LIKE over every row.
--
-- What a room suits is not stored either. There is `category`, which has four
-- values, and Movement Studio covers yoga and pilates and mobility work
-- alike — so a page for each would list identical rooms, which is one page
-- with two addresses as far as a search engine is concerned.
--
-- Done now, with no listings in the table, on purpose. Every column here is
-- filled by the geocoder or the listing form at the moment a space is created;
-- adding them later means the same work plus backfilling rows whose answers
-- have to be guessed from a formatted address. This is the cheapest this
-- migration will ever be.

alter table spaces
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  -- Multi-valued, because rooms are. A reformer studio is genuinely bookable
  -- for yoga; making the host pick one label would be less true and would also
  -- halve the pages that room can appear on.
  add column if not exists suitable_for text[] not null default '{}';

comment on column spaces.city is
  'Locality from the geocoder, e.g. "San Mateo". Public — it is on the listing.';
comment on column spaces.state is
  'Two-letter state from the geocoder, e.g. "CA".';
comment on column spaces.suitable_for is
  'Slugs from src/lib/space-types.ts. Each one is a URL; see the constraint below.';

/*
 * The list is a constraint, which makes adding a use a migration.
 *
 * That is the point rather than an inconvenience. Every value here becomes
 * /spaces/ca/san-mateo/<value> — a page that gets indexed, linked to, and
 * ranked over months. A typo that reaches this column is a page that quietly
 * splits the traffic of a real one, and nothing about a text[] would ever
 * complain about it.
 *
 * Dropped first so the migration can be run against a database that already
 * has an older version of the list.
 */
alter table spaces drop constraint if exists spaces_suitable_for_known;

alter table spaces add constraint spaces_suitable_for_known check (
  suitable_for <@ array[
    'pilates-studio',
    'yoga-studio',
    'movement-studio',
    'massage-room',
    'treatment-room',
    'acupuncture-room',
    'esthetician-room',
    'consultation-room',
    'meditation-room',
    'reiki-room'
  ]::text[]
);

/*
 * Both indexes are partial on `status = 'active'`.
 *
 * Every query that will use them is a public page asking "what is bookable
 * here", and a pending or delisted room is never part of that answer. A
 * partial index is smaller, and it stays small as rejected and retired
 * listings accumulate — which they do, and which the pages never look at.
 */
create index if not exists spaces_active_place_idx
  on spaces (state, city)
  where status = 'active';

create index if not exists spaces_active_suitable_for_idx
  on spaces using gin (suitable_for)
  where status = 'active';

/*
 * The public view, carrying the two new axes.
 *
 * Dropped rather than replaced: `create or replace view` cannot add a column
 * in the middle, and every earlier migration that touched this view has the
 * same note. The grants go with the drop, so they are restated — forgetting
 * that is how browse goes blank for signed-out visitors.
 *
 * Copied forward from 0035, which is the current shape, and not from the
 * older one two migrations before it. That is the whole hazard of a view
 * rebuilt by hand in every migration that touches it: 0032 published the
 * street address on purpose and 0023's approximate coordinates went with it,
 * so starting from the wrong version silently un-ships a decision. The columns
 * below are 0035's, with four added at the end.
 *
 * `area` stays alongside `city`. They are not the same answer: one is "San
 * Mateo, CA 94404, USA" for printing, the other is "San Mateo" for grouping,
 * and the pages need the second.
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
    city, state, postal_code, suitable_for
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;

/*
 * A town with rooms in it, counted once.
 *
 * The pages have a rule: a city page is only worth indexing when there is
 * something on it. Thin pages are the way programmatic SEO fails — a thousand
 * near-empty addresses teach a search engine that this site is mostly nothing,
 * and that judgement is applied to the pages that are not.
 *
 * Counting is done here rather than in the app so that the sitemap, the page's
 * own robots tag and the internal links all read the same number. Three
 * separate counts drift, and the way that shows up is a sitemap advertising
 * pages that tell the crawler not to index them.
 */
create or replace view city_inventory as
  select
    state,
    city,
    count(*)::int as space_count,
    min(hourly_rate_cents)::int as min_cents,
    max(hourly_rate_cents)::int as max_cents,
    -- Not an average. One expensive room drags a mean somewhere no room
    -- actually costs, and this number ends up on a page answering "how much
    -- does it cost here".
    (percentile_cont(0.5) within group (order by hourly_rate_cents))::int as median_cents,
    max(updated_at) as updated_at
  from spaces
  where status = 'active' and city is not null and state is not null
  group by state, city;

grant select on city_inventory to anon, authenticated;
grant select on city_inventory to service_role;

/** The same, split by what each room is bookable for. */
create or replace view city_type_inventory as
  select
    s.state,
    s.city,
    t.slug as space_type,
    count(*)::int as space_count,
    min(s.hourly_rate_cents)::int as min_cents,
    max(s.hourly_rate_cents)::int as max_cents,
    (percentile_cont(0.5) within group (order by s.hourly_rate_cents))::int as median_cents,
    max(s.updated_at) as updated_at
  from spaces s
  cross join lateral unnest(s.suitable_for) as t(slug)
  where s.status = 'active' and s.city is not null and s.state is not null
  group by s.state, s.city, t.slug;

grant select on city_type_inventory to anon, authenticated;
grant select on city_type_inventory to service_role;
