-- Listing detail the wizard already collects but had nowhere to land:
-- amenities, a description, and the host's house rules.
--
-- `requirements` holds keys from the fixed vocabulary in src/lib/taxonomy.ts —
-- grip socks, no open flame, quiet building — rather than sentences. Keys can
-- be shown before booking, scanned at a glance and translated later; sentences
-- can only be read.
--
-- `house_rules` is the free-text overflow for the genuinely specific ("the cat
-- lives in the back room, please keep the door shut"). Deliberately secondary
-- to the structured list: anything common belongs in the vocabulary, where it
-- is visible and consistent across listings.
--
-- Both are on `spaces` and both are exposed through spaces_public, because a
-- rule discovered after paying is exactly the surprise this app refuses
-- everywhere else. They are requirements, not fine print.

alter table spaces
  add column if not exists description text not null default '',
  add column if not exists amenities text[] not null default '{}',
  add column if not exists requirements text[] not null default '{}',
  add column if not exists house_rules text not null default '';

-- Recreated rather than altered: a view does not pick up new columns on its
-- own, and Discover cannot show a rule it never selected.
create or replace view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, status, created_at,
    description, amenities, requirements, house_rules
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
