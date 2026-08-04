-- Minimum Stress Spaces — full schema, generated from supabase/migrations/
-- Paste into the Supabase SQL editor and run once, on an empty project.
--
-- 0000_supabase_stubs.sql is deliberately NOT included: it recreates what
-- Supabase already provides and exists only so the test suite can run the
-- migrations against a bare Postgres.


-- ===================================================================
-- 0001_schema.sql
-- ===================================================================

-- Minimum Stress Spaces — core schema
--
-- Not yet applied to a live project. Written against the data model in the
-- Phase 1 plan; run `supabase db push` (or paste into the SQL editor) once
-- Supabase keys are available, then read it back with `supabase db diff` to
-- confirm nothing drifted before trusting it in production.
--
-- Money columns mirror src/lib/money.ts's BookingMoney type field-for-field,
-- because a booking freezes the quote that produced it — a host raising their
-- rate later must never rewrite what a past booking cost.

-- No pgcrypto extension: gen_random_uuid() has been core Postgres since 13 and
-- Supabase runs 15+, so requiring the extension would only narrow where these
-- migrations can run.

create type space_category as enum ('physical', 'traditional', 'social', 'spirit');
create type access_type as enum ('keypad', 'lockbox', 'greeter');
create type restroom_option as enum ('private', 'shared', 'none');
create type space_status as enum ('pending', 'active', 'delisted');
create type media_kind as enum ('image', 'video');
create type payout_schedule as enum ('standard', 'instant');
create type booking_status as enum (
  'upcoming',
  'completed',
  'cancelled_by_practitioner',
  'cancelled_by_host',
  'no_show'
);
create type cancelled_by_actor as enum ('practitioner', 'host');
create type credit_reason as enum ('host_cancellation', 'booking_redemption', 'goodwill_restore');

-- ------------------------------------------------------------------
-- profiles
--
-- One row per auth.users row. No "role" column: the brief's Role Select
-- screen ("You can switch anytime from the top of either screen") is a UI
-- entry point, not a database-enforced identity — the same person can host a
-- space and book someone else's on the same account.
-- ------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_path text,
  is_pro boolean not null default false,
  pro_since timestamptz,
  stripe_customer_id text unique,
  stripe_connect_account_id text unique,
  stripe_connect_charges_enabled boolean not null default false,
  insurance_doc_path text,
  payout_schedule payout_schedule not null default 'standard',
  notify_bookings boolean not null default true,
  notify_payouts boolean not null default true,
  notify_offers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- spaces
--
-- room_type is not stored: it is a pure function of category
-- (lib/taxonomy.ts roomTypeFor), so there is exactly one place the two can
-- ever disagree — the lookup table — rather than a column that can drift
-- from it.
--
-- address_line / lat / lng / entry_instructions are private until a
-- practitioner has a confirmed booking on this space. See 0002_rls.sql for
-- how that boundary is actually enforced — column *visibility* rather than
-- a client-side check, so the private fields never leave the server for an
-- unauthorized request in the first place.
-- ------------------------------------------------------------------
create table spaces (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  category space_category not null,
  hourly_rate_cents integer not null check (hourly_rate_cents > 0),
  capacity integer not null check (capacity > 0),
  access_type access_type not null,
  entry_instructions text not null,
  address_line text not null,
  lat double precision,
  lng double precision,
  accessible boolean,
  restroom restroom_option,
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  status space_status not null default 'pending',
  sublease_doc_path text not null,
  insurance_doc_path text,
  legal_ack_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spaces_host_id_idx on spaces (host_id);
create index spaces_status_idx on spaces (status) where status = 'active';

-- ------------------------------------------------------------------
-- space_media
--
-- The brief requires at least one photo or video per listing but never
-- gates step 1 or 2 on anything past that, so this table has no NOT NULL
-- constraint tying it to a minimum count — that rule lives in application
-- validation at submission time, where it can produce a helpful error
-- instead of a database exception.
-- ------------------------------------------------------------------
create table space_media (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces (id) on delete cascade,
  storage_path text not null,
  kind media_kind not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index space_media_space_id_idx on space_media (space_id, position);

-- ------------------------------------------------------------------
-- availability
--
-- One row per block, not one row per day. This is what lets a single Monday
-- hold 7-8am, 2-3pm and 5-9pm as three independent rows rather than forcing
-- one start/end pair per weekday.
-- ------------------------------------------------------------------
create table availability (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  constraint availability_ordered check (end_minute > start_minute)
);

create index availability_space_id_idx on availability (space_id, weekday);

-- ------------------------------------------------------------------
-- bookings
--
-- Every money column is frozen at creation from a src/lib/money.ts Quote —
-- never recomputed from the space's current rate. access_code is generated
-- but withheld from API responses until access_code_revealed_at (target:
-- T-30min), enforced server-side, not by hiding it in the client.
-- ------------------------------------------------------------------
-- on delete restrict, deliberately: a booking is a financial record tied to a
-- Stripe PaymentIntent and possibly a credit_ledger entry. Cascading a space
-- or profile deletion into it would silently destroy the audit trail for money
-- that actually moved. Deleting either has to reckon with its bookings first.
create table bookings (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces (id) on delete restrict,
  practitioner_id uuid not null references profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status booking_status not null default 'upcoming',
  is_instant boolean not null,
  was_pro boolean not null,

  -- Frozen quote — see src/lib/money.ts BookingMoney.
  host_rate_cents integer not null,
  service_fee_cents integer not null,
  instant_fee_cents integer not null,
  pro_discount_cents integer not null,
  credit_applied_cents integer not null,
  total_cents integer not null,
  platform_cents integer not null,

  stripe_payment_intent_id text unique,
  authorized_at timestamptz,
  captured_at timestamptz,

  cancelled_at timestamptz,
  cancelled_by cancelled_by_actor,

  access_code text,
  access_code_revealed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint bookings_ordered check (ends_at > starts_at),
  constraint bookings_cancellation_consistent check (
    (cancelled_at is null) = (cancelled_by is null)
  )
);

create index bookings_practitioner_id_idx on bookings (practitioner_id);
create index bookings_space_id_idx on bookings (space_id);
create index bookings_starts_at_idx on bookings (starts_at) where status = 'upcoming';

-- ------------------------------------------------------------------
-- credit_ledger
--
-- Append-only. The balance is never a stored number — it is always
-- SUM(delta_cents), matching lib/money.ts's creditBalance(). A mutable
-- balance column next to this table would be exactly the bug the prototype
-- had, where credits.balance and credits.ledger could drift apart.
-- ------------------------------------------------------------------
create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references profiles (id) on delete restrict,
  delta_cents integer not null,
  reason credit_reason not null,
  booking_id uuid references bookings (id) on delete restrict,
  note text,
  created_at timestamptz not null default now()
);

create index credit_ledger_practitioner_id_idx on credit_ledger (practitioner_id);

-- security_invoker is load-bearing here, not decoration: without it this
-- view runs as its owner (typically the migration role) and RLS on
-- credit_ledger never applies, so every practitioner's balance becomes
-- readable by anyone granted select on the view. With it, the view enforces
-- exactly the same row policies the base table does for the querying user.
create or replace view credit_balances
  with (security_invoker = true) as
  select practitioner_id, coalesce(sum(delta_cents), 0)::integer as balance_cents
  from credit_ledger
  group by practitioner_id;

-- ===================================================================
-- 0002_rls.sql
-- ===================================================================

-- Row Level Security
--
-- Two settings from the brief stay exactly as configured and this migration
-- does not touch them: RLS is enabled project-wide, and auto-expose-new-tables
-- stays off, so a table only becomes reachable once deliberately granted here.
--
-- The organising rule, because getting this wrong is how address_line leaks:
--
--   Base tables are owner-only. authenticated may reach its own rows;
--     anon may not reach them at all.
--   Anything public goes through a security *definer* view, whose safety comes
--     from its explicit column list and WHERE clause rather than from RLS.
--   Anything per-user goes through a security *invoker* view, so the caller's
--     own row policies still apply.
--
-- The distinction is load-bearing. An invoker view over a table the caller has
-- no grant on simply errors, so "public subset" views cannot be invoker; and a
-- definer view over per-user data bypasses RLS and would hand every
-- practitioner's balance to whoever asked, so per-user views cannot be definer.
--
-- Writes to bookings and credit_ledger happen server-side under the service
-- role, never from the client: a cancellation has to void or capture a Stripe
-- PaymentIntent and write a ledger row in one transaction, and RLS can gate who
-- writes a row but cannot make that write atomic with an external API call.

alter table profiles enable row level security;
alter table spaces enable row level security;
alter table space_media enable row level security;
alter table availability enable row level security;
alter table bookings enable row level security;
alter table credit_ledger enable row level security;

-- ------------------------------------------------------------------
-- Table privileges
--
-- Not redundant with the policies below: a policy narrows which rows a role
-- may touch, a GRANT decides whether it may touch the table at all. With
-- auto-expose off there are no defaults, so a policy without a matching grant
-- is dead code — the role is refused before RLS is ever consulted.
-- ------------------------------------------------------------------

grant select, insert, update on profiles to authenticated;
grant select, insert, update, delete on spaces to authenticated;
grant select, insert, update, delete on space_media to authenticated;
grant select, insert, update, delete on availability to authenticated;
grant select on bookings to authenticated;
grant select on credit_ledger to authenticated;

-- ------------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------------

create policy "profiles: read own row"
  on profiles for select
  using (id = auth.uid());

create policy "profiles: insert own row"
  on profiles for insert
  with check (id = auth.uid());

create policy "profiles: update own row"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------------
-- spaces — host-only at the table. Practitioners never select from it
-- directly; they read spaces_public, and the private fields come from
-- space_access_details() once they hold a booking.
-- ------------------------------------------------------------------

create policy "spaces: host reads own rows, any status"
  on spaces for select
  using (host_id = auth.uid());

create policy "spaces: host inserts own rows"
  on spaces for insert
  with check (host_id = auth.uid());

create policy "spaces: host updates own rows"
  on spaces for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

create policy "spaces: host deletes own rows"
  on spaces for delete
  using (host_id = auth.uid());

-- ------------------------------------------------------------------
-- space_media / availability — host-only at the table, same as spaces.
-- Public reads go through the *_public views further down.
-- ------------------------------------------------------------------

create policy "space_media: host manages own space's media"
  on space_media for all
  using (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()))
  with check (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()));

create policy "availability: host manages own space's schedule"
  on availability for all
  using (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()))
  with check (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()));

-- ------------------------------------------------------------------
-- bookings / credit_ledger — read-only for the parties involved.
-- ------------------------------------------------------------------

create policy "bookings: practitioner reads own bookings"
  on bookings for select
  using (practitioner_id = auth.uid());

create policy "bookings: host reads bookings on own spaces"
  on bookings for select
  using (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()));

create policy "credit_ledger: practitioner reads own entries"
  on credit_ledger for select
  using (practitioner_id = auth.uid());

-- ==================================================================
-- Public views — security DEFINER (the default).
--
-- Safety here is structural: the column list decides what exists at all, so
-- address_line, the Stripe identifiers and the document paths are not
-- omitted-but-reachable, they are absent. A future policy change cannot
-- widen them back into view.
-- ==================================================================

create or replace view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, status, created_at
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;

create or replace view public_host_profiles as
  select id, display_name, avatar_path
  from profiles;

grant select on public_host_profiles to anon, authenticated;

create or replace view availability_public as
  select a.id, a.space_id, a.weekday, a.start_minute, a.end_minute
  from availability a
  join spaces s on s.id = a.space_id
  where s.status = 'active';

grant select on availability_public to anon, authenticated;

create or replace view space_media_public as
  select m.id, m.space_id, m.storage_path, m.kind, m.position
  from space_media m
  join spaces s on s.id = m.space_id
  where s.status = 'active';

grant select on space_media_public to anon, authenticated;

-- ==================================================================
-- Per-user views — security INVOKER, so the caller's row policies apply.
-- ==================================================================

-- Without security_invoker this aggregate would sum the entire ledger and
-- hand every practitioner's balance to whoever queried it.
create or replace view credit_balances
  with (security_invoker = true) as
  select practitioner_id, coalesce(sum(delta_cents), 0)::integer as balance_cents
  from credit_ledger
  group by practitioner_id;

grant select on credit_balances to authenticated;

-- access_code itself is never selected here. The reveal is a server-side
-- timer flipping access_code_revealed_at; the raw value must not round-trip
-- to a client that is not yet entitled to it, even into a field the UI
-- happens not to render.
create or replace view bookings_with_access_code
  with (security_invoker = true) as
  select
    b.id, b.space_id, b.practitioner_id, b.starts_at, b.ends_at, b.status,
    b.is_instant, b.was_pro, b.host_rate_cents, b.service_fee_cents,
    b.instant_fee_cents, b.pro_discount_cents, b.credit_applied_cents,
    b.total_cents, b.platform_cents, b.captured_at, b.cancelled_at,
    b.cancelled_by, b.access_code_revealed_at, b.created_at,
    case
      when b.practitioner_id = auth.uid() and b.access_code_revealed_at <= now()
        then b.access_code
      else null
    end as revealed_access_code
  from bookings b;

grant select on bookings_with_access_code to authenticated;

-- ==================================================================
-- Address reveal — a security definer function, not a view.
--
-- A practitioner has no row policy on `spaces`, so an invoker view would
-- return nothing to exactly the person entitled to the address. Granting
-- them a row policy instead would expose every other column on the row,
-- including the host's sublease document path. A definer function is the
-- narrow instrument: it runs the ownership check itself and returns only the
-- five fields needed to walk into the room.
-- ==================================================================

create or replace function space_access_details(p_space_id uuid)
returns table (
  address_line text,
  lat double precision,
  lng double precision,
  entry_instructions text,
  access_type access_type
)
language sql
stable
security definer
set search_path = public
as $$
  select s.address_line, s.lat, s.lng, s.entry_instructions, s.access_type
  from spaces s
  where s.id = p_space_id
    and exists (
      select 1 from bookings b
      where b.space_id = s.id
        and b.practitioner_id = auth.uid()
        and b.status in ('upcoming', 'completed')
    );
$$;

revoke all on function space_access_details(uuid) from public;
grant execute on function space_access_details(uuid) to authenticated;

-- ===================================================================
-- 0003_storage.sql
-- ===================================================================

-- Storage buckets
--
-- Three buckets, split by sensitivity rather than by feature, since that is
-- what the access policy actually depends on:
--
--   avatars        public read, one folder per user, owner-only write
--   space-media    public read (it's marketing content — photos/video of a
--                  room, never the address), host-only write on own space
--   verification-docs   private. Sublease proof, space insurance, and
--                  practitioner insurance certs. No in-app admin panel yet
--                  (the brief calls this out as deliberate, not an
--                  oversight), so review happens by staff through the
--                  Supabase dashboard with the service role — no client
--                  policy grants read access to anyone but the uploader.
--
-- Path convention: "{owner-scoped folder}/{filename}", so a single
-- storage.foldername(name) check can express "is this yours" without a
-- table join for avatars, and with one join for the space-scoped buckets.

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('space-media', 'space-media', true),
  ('verification-docs', 'verification-docs', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------------
-- avatars — path: {user_id}/{filename}
-- ------------------------------------------------------------------

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: owner writes own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: owner updates own folder"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: owner deletes own folder"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------------
-- space-media — path: {space_id}/{filename}
-- ------------------------------------------------------------------

create policy "space-media: public read"
  on storage.objects for select
  using (bucket_id = 'space-media');

create policy "space-media: host writes own space's folder"
  on storage.objects for insert
  with check (
    bucket_id = 'space-media'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[1]
        and s.host_id = auth.uid()
    )
  );

create policy "space-media: host deletes own space's folder"
  on storage.objects for delete
  using (
    bucket_id = 'space-media'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[1]
        and s.host_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------
-- verification-docs — no public read.
-- Paths: space/{space_id}/{filename}, practitioner/{user_id}/{filename}
-- ------------------------------------------------------------------

create policy "verification-docs: host reads own space's docs"
  on storage.objects for select
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'space'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[2]
        and s.host_id = auth.uid()
    )
  );

create policy "verification-docs: host writes own space's docs"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'space'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[2]
        and s.host_id = auth.uid()
    )
  );

create policy "verification-docs: practitioner reads own docs"
  on storage.objects for select
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'practitioner'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "verification-docs: practitioner writes own docs"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'practitioner'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ===================================================================
-- 0004_narrow_public_profiles.sql
-- ===================================================================

-- Narrow public_host_profiles to actual hosts.
--
-- As first written it selected every row in `profiles`, so a practitioner's
-- display name and avatar were world-readable to any anonymous caller — the
-- view's name claimed a restriction its body never applied.
--
-- Only someone with a live listing needs a public identity: that is the name
-- attached to a room in Discover. A practitioner has no public presence in this
-- product at all.
--
-- Note for later: a host legitimately needs to see who booked their space, and
-- that is now deliberately not served here. It belongs in a security definer
-- function scoped to "practitioners holding a booking on a space you own",
-- alongside space_access_details, rather than in a world-readable view.

create or replace view public_host_profiles as
  select p.id, p.display_name, p.avatar_path
  from profiles p
  where exists (
    select 1
    from spaces s
    where s.host_id = p.id
      and s.status = 'active'
  );

grant select on public_host_profiles to anon, authenticated;

-- ===================================================================
-- 0005_host_bookings.sql
-- ===================================================================

-- Who booked my room?
--
-- 0004 narrowed public_host_profiles to actual hosts, which was right — a
-- practitioner has no public presence in this product — but it left a real gap:
-- a host must be able to see who is coming into their space, and that name now
-- lives behind RLS they cannot cross.
--
-- The answer is not to widen the public view back out. It is a function scoped
-- to exactly the relationship that justifies the access: you may see a
-- practitioner's name because they hold a booking on a space *you own*.
--
-- Note what it returns and what it does not. host_rate_cents is the host's net,
-- and no service fee, instant fee or platform figure appears anywhere in the
-- signature. The brief is explicit that hosts see earnings, never a percentage,
-- and leaving those columns out means a careless `select *` on the client
-- cannot leak them.

create or replace function host_bookings()
returns table (
  booking_id uuid,
  space_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status booking_status,
  net_cents integer,
  practitioner_name text,
  practitioner_avatar_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.space_id,
    b.starts_at,
    b.ends_at,
    b.status,
    b.host_rate_cents,
    p.display_name,
    p.avatar_path
  from bookings b
  join spaces s on s.id = b.space_id
  join profiles p on p.id = b.practitioner_id
  where s.host_id = auth.uid()
  order by b.starts_at;
$$;

revoke all on function host_bookings() from public;
grant execute on function host_bookings() to authenticated;

-- ===================================================================
-- 0006_service_role_grants.sql
-- ===================================================================

-- Give service_role access to the tables the server actually writes.
--
-- This was missing, and the failure mode was thoroughly misleading: the secret
-- key authenticated fine — Storage answered 200 with it — while every REST call
-- came back denied. It read like a bad key. It was a missing GRANT.
--
-- The same lesson as 0002: BYPASSRLS lets a role ignore row policies, it does
-- not let it touch a table it has no privilege on. Stock Supabase hides this by
-- granting service_role everything through default privileges; with
-- auto-expose-new-tables off there are no defaults, so nothing is granted until
-- it is written down here.
--
-- Safe because the secret key never reaches a browser: src/lib/supabase/env.ts
-- throws if it is read client-side, and src/lib/stripe/client.ts and the server
-- helpers are marked server-only.
--
-- Full access rather than a narrow list, deliberately. service_role is the
-- trusted server identity that has to write a booking, its credit_ledger entry
-- and a Stripe PaymentIntent as one unit, and reconcile them from webhooks
-- afterwards. Trimming these grants would not add safety — anything holding
-- this key can already act as the platform — it would only produce a puzzling
-- 403 the next time a route needed a column nobody anticipated.

grant usage on schema public to service_role;

grant all privileges on table profiles to service_role;
grant all privileges on table spaces to service_role;
grant all privileges on table space_media to service_role;
grant all privileges on table availability to service_role;
grant all privileges on table bookings to service_role;
grant all privileges on table credit_ledger to service_role;

grant select on table spaces_public to service_role;
grant select on table public_host_profiles to service_role;
grant select on table availability_public to service_role;
grant select on table space_media_public to service_role;
grant select on table credit_balances to service_role;
grant select on table bookings_with_access_code to service_role;

grant execute on function space_access_details(uuid) to service_role;
grant execute on function host_bookings() to service_role;

-- Anything added later inherits these, so the next table does not repeat the
-- same debugging session.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

-- ===================================================================
-- 0007_space_details.sql
-- ===================================================================

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
  add column description text not null default '',
  add column amenities text[] not null default '{}',
  add column requirements text[] not null default '{}',
  add column house_rules text not null default '';

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
