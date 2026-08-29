-- Individual inventory moves inside the signed-in marketplace.
--
-- The public marketing site historically served a full listing to a stranger:
-- name, description, photographs, price, capacity, amenities, house rules and
-- reviews, one page per room, all of it read straight from views granted to
-- `anon` and photographs served from a public storage bucket. That was the SEO
-- engine's whole design, and it is no longer the product we want: a host's
-- studio is not public classifieds. Where the marketplace operates — the city,
-- the category, how many rooms, a safe price band — stays public and helps
-- people discover Minimum Stress. Which room, run by whom, at what address, for
-- how much, belongs to people signed in to the app.
--
-- The boundary this migration draws:
--
--   anon           may read ONLY the aggregate inventory views —
--                  city_inventory, city_type_inventory, and the new
--                  city_category_inventory — plus space_demand, and may still
--                  INSERT a space_request. It can no longer read any per-listing
--                  view or fetch any listing photograph.
--
--   authenticated  is unchanged. The app reads spaces_public,
--                  availability_public, space_media_public, space_ratings,
--                  public_reviews and public_host_profiles exactly as before,
--                  and signs its own media URLs against the private bucket.
--
--   booked users   are untouched. The exact address, precise coordinates and
--                  entry instructions still come only through
--                  space_access_details(), whose booking check this migration
--                  does not go near.
--
-- Nothing about pricing, the service fee, RLS on the base tables, or the
-- booking/access timing changes here. This is purely who may read the public
-- projections of inventory, and whether media is world-readable.
--
-- Idempotent: every REVOKE is a no-op if the grant is already gone, the policy
-- is dropped-if-exists before it is recreated, the bucket update is
-- unconditional, and the aggregate view is create-or-replace.

-- ------------------------------------------------------------------
-- 1. Close the per-listing views to anonymous visitors.
--
-- These stay granted to `authenticated` (and service_role) from their original
-- migrations; only `anon`'s read is withdrawn. PostgREST refuses a select the
-- role has no grant for before RLS is even consulted, so this alone stops an
-- anonymous request to any of them.
-- ------------------------------------------------------------------

revoke select on spaces_public from anon;
revoke select on space_media_public from anon;
revoke select on availability_public from anon;
revoke select on space_ratings from anon;
revoke select on public_reviews from anon;
revoke select on public_host_profiles from anon;

-- ------------------------------------------------------------------
-- 2. Aggregate inventory, with a small-group price floor.
--
-- The town / use / category counts stay public — where the marketplace
-- operates and how deep it is. But a min/median/max over one or two rooms is
-- not a market rate: it is an individual host's price wearing a market's
-- clothes, and publishing it hands a specific listing's price to anyone who
-- reads the aggregate directly (PostgREST, not just the page). So below three
-- active rooms the three price columns come back NULL — at the view, not merely
-- hidden in React — while the count stays. Three is the same bar the pages
-- already used to decide whether to *print* a range (priceRange /
-- MIN_LISTINGS_TO_INDEX); this moves the guarantee into the database so it holds
-- for every reader, not only the rendered page.
--
-- city_inventory and city_type_inventory are redefined here (create-or-replace
-- keeps their column set from 0043, only wrapping the price aggregates); the new
-- city_category_inventory closes the last gap — the /spaces category filter,
-- which used to group rows read from spaces_public. A room carries exactly one
-- category, so counting by (state, city, category) is exact.
-- ------------------------------------------------------------------

create or replace view city_inventory as
  select
    state,
    city,
    count(*)::int as space_count,
    case when count(*) >= 3 then min(hourly_rate_cents)::int end as min_cents,
    case when count(*) >= 3 then max(hourly_rate_cents)::int end as max_cents,
    case
      when count(*) >= 3
      then (percentile_cont(0.5) within group (order by hourly_rate_cents))::int
    end as median_cents,
    max(updated_at) as updated_at
  from spaces
  where status = 'active' and city is not null and state is not null
  group by state, city;

grant select on city_inventory to anon, authenticated;
grant select on city_inventory to service_role;

create or replace view city_type_inventory as
  select
    s.state,
    s.city,
    t.slug as space_type,
    count(*)::int as space_count,
    case when count(*) >= 3 then min(s.hourly_rate_cents)::int end as min_cents,
    case when count(*) >= 3 then max(s.hourly_rate_cents)::int end as max_cents,
    case
      when count(*) >= 3
      then (percentile_cont(0.5) within group (order by s.hourly_rate_cents))::int
    end as median_cents,
    max(s.updated_at) as updated_at
  from spaces s
  cross join lateral unnest(s.suitable_for) as t(slug)
  where s.status = 'active' and s.city is not null and s.state is not null
  group by s.state, s.city, t.slug;

grant select on city_type_inventory to anon, authenticated;
grant select on city_type_inventory to service_role;

create or replace view city_category_inventory as
  select
    state,
    category,
    city,
    count(*)::int as space_count,
    case when count(*) >= 3 then min(hourly_rate_cents)::int end as min_cents,
    case when count(*) >= 3 then max(hourly_rate_cents)::int end as max_cents,
    case
      when count(*) >= 3
      then (percentile_cont(0.5) within group (order by hourly_rate_cents))::int
    end as median_cents,
    max(updated_at) as updated_at
  from spaces
  where status = 'active' and city is not null and state is not null
  group by state, category, city;

grant select on city_category_inventory to anon, authenticated;
grant select on city_category_inventory to service_role;

-- ------------------------------------------------------------------
-- 3. Media stops being world-readable.
--
-- Hiding the URLs in React is not enough while the bucket is public: the object
-- is fetchable by anyone who has, or guesses, its path. So the bucket goes
-- private and the blanket public-read policy is replaced with one scoped to
-- signed-in users, and to listings that are actually live (a host still reads
-- their own space's media at any status, for the listing manager). The app
-- reads media by minting short-lived signed URLs with the caller's own session;
-- anonymous callers, having no session and no policy, get nothing. Host upload
-- and delete policies (0003/0017) are untouched, so listing management is
-- unaffected.
-- ------------------------------------------------------------------

update storage.buckets set public = false where id = 'space-media';

drop policy if exists "space-media: public read" on storage.objects;
drop policy if exists "space-media: read active listings or own" on storage.objects;

create policy "space-media: read active listings or own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'space-media'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[1]
        and (s.status = 'active' or s.host_id = auth.uid())
    )
  );
